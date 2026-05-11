import { prisma, type SponsorshipStatusValue } from '@arcpass/shared'
import type { WorkerConfig } from './config.js'
import {
  transitionSponsorshipStatus,
  createRelayTransaction,
  updateRelayTransaction,
  getRetryCount,
} from './lifecycle.js'
import { executeRelay, type RelayResult } from './relay-executor.js'
import { createLogger } from './logger.js'

const logger = createLogger('processor')

export interface ProcessResult {
  requestId: string
  success: boolean
  finalStatus: SponsorshipStatusValue
  error?: string
}

/**
 * Determines if a relay failure reason indicates an AlreadySponsored contract error.
 * When the on-chain contract has already transferred funds, the relay should be
 * treated as a success (confirmed) rather than a failure.
 */
export function isAlreadySponsoredError(failureReason: string | null): boolean {
  return failureReason?.startsWith('AlreadySponsored') ?? false
}

/**
 * Processes a single sponsorship request through the full lifecycle
 * within a single database transaction.
 *
 * Flow: pending → approved → relayed → completed/failed
 *
 * Uses SELECT FOR UPDATE SKIP LOCKED to acquire an exclusive row-level lock.
 * If the request doesn't exist or is already locked, processing is skipped.
 */
export async function processRequest(
  requestId: string,
  config: WorkerConfig
): Promise<ProcessResult> {
  const processorStartTime = Date.now()
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Step 1: Acquire row-level lock via SELECT FOR UPDATE SKIP LOCKED
        const locked = await tx.$queryRaw<Array<{ id: string; status: string; walletId: string }>>`
          SELECT id, status, "walletId" FROM "sponsorship_requests"
          WHERE id = ${requestId}
          FOR UPDATE SKIP LOCKED
        `

        // If no rows returned, request doesn't exist or is already locked
        if (!locked || locked.length === 0) {
          return {
            requestId,
            success: true,
            finalStatus: 'pending' as SponsorshipStatusValue,
            error: 'Request not found or already locked — skipped',
          }
        }

        const currentStatus = locked[0].status as SponsorshipStatusValue
        const walletId = locked[0].walletId

        // Only process requests that are in 'pending' or 'relayed' (stale execution recovery) status
        if (currentStatus !== 'pending' && currentStatus !== 'relayed') {
          logger.info('Skipping request — not in processable status', {
            sponsorshipRequestId: requestId,
            currentStatus,
          })
          return {
            requestId,
            success: true,
            finalStatus: currentStatus,
            error: `Request is in "${currentStatus}" status — skipped`,
          }
        }

        // Step 3: Check wallet.isBlocked → reject if true (only for pending requests)
        const wallet = await (tx as any).wallet.findUnique({ where: { id: walletId } })
        if (currentStatus === 'pending' && wallet?.isBlocked) {
          await transitionSponsorshipStatus(tx as any, requestId, 'rejected')
          await (tx as any).sponsorshipRequest.update({
            where: { id: requestId },
            data: { eligibilityReason: 'Wallet is blocked' },
          })
          logger.info('Request rejected — wallet is blocked', {
            sponsorshipRequestId: requestId,
            walletAddress: wallet.walletAddress,
          })
          return { requestId, success: true, finalStatus: 'rejected' as SponsorshipStatusValue }
        }

        const walletAddress = wallet?.walletAddress ?? 'unknown'

        // Log: processor begins processing (Requirement 6.1)
        logger.info('Processing sponsorship request', {
          sponsorshipRequestId: requestId,
          walletAddress,
          relayAttempt: (await getRetryCount(tx as any, requestId)) + 1,
        })

        // Step 4: Check for existing confirmed/submitted relay → idempotency guard
        const existingActiveRelay = await (tx as any).relayTransaction.findFirst({
          where: {
            sponsorshipRequestId: requestId,
            status: { in: ['submitted', 'confirmed'] },
          },
        })

        if (existingActiveRelay) {
          if (existingActiveRelay.status === 'confirmed') {
            // Completion shortcut: transition to completed and increment sponsorshipCount
            const completeResult = await transitionSponsorshipStatus(
              tx as any,
              requestId,
              'completed'
            )
            if (!completeResult.success) {
              throw new Error(`Failed to transition to completed: ${completeResult.error}`)
            }
            await (tx as any).wallet.update({
              where: { id: walletId },
              data: { sponsorshipCount: { increment: 1 } },
            })
            logger.info('Existing confirmed relay found — completed with count increment', {
              sponsorshipRequestId: requestId,
              relayTransactionId: existingActiveRelay.id,
              walletAddress,
            })
            return {
              requestId,
              success: true,
              finalStatus: 'completed' as SponsorshipStatusValue,
            }
          }

          // Status is 'submitted' — already in-flight, skip processing
          logger.info('Skipping relay — submitted relay transaction already in-flight', {
            sponsorshipRequestId: requestId,
            relayTransactionId: existingActiveRelay.id,
            walletAddress,
          })
          return {
            requestId,
            success: true,
            finalStatus: currentStatus,
            error: `Active relay transaction already exists (status: ${existingActiveRelay.status}) — skipped`,
          }
        }

        // Step 5: Check retry count — enforce max retry limit (Req 9.3, 9.5, 11.3)
        // Uses >= comparison to ensure no new relay transaction is created at the limit
        const retryCount = await getRetryCount(tx as any, requestId)
        if (retryCount >= config.maxRetries) {
          const failResult = await transitionSponsorshipStatus(
            tx as any,
            requestId,
            'failed'
          )
          if (!failResult.success) {
            throw new Error(`Failed to transition to failed: ${failResult.error}`)
          }
          logger.info('Request exceeded max retries — transitioned to failed', {
            sponsorshipRequestId: requestId,
            retryCount,
            maxRetries: config.maxRetries,
            walletAddress,
            previousStatus: currentStatus,
            newStatus: 'failed',
          })
          return {
            requestId,
            success: true,
            finalStatus: 'failed' as SponsorshipStatusValue,
          }
        }

        // Step 6: Prepare for relay execution
        // For pending requests: transition pending → approved → relayed
        // For stale relayed requests: skip transitions, create new relay transaction directly
        let relayTx: { id: string; relayAttempt: number }

        if (currentStatus === 'pending') {
          // Transition pending → approved
          const approveResult = await transitionSponsorshipStatus(
            tx as any,
            requestId,
            'approved'
          )
          if (!approveResult.success) {
            throw new Error(`Failed to transition to approved: ${approveResult.error}`)
          }
          logger.info('Status transition', {
            sponsorshipRequestId: requestId,
            walletAddress,
            previousStatus: 'pending',
            newStatus: 'approved',
          })

          // Create relay transaction
          relayTx = await createRelayTransaction(tx as any, requestId)

          // Transition approved → relayed
          const relayTransitionResult = await transitionSponsorshipStatus(
            tx as any,
            requestId,
            'relayed'
          )
          if (!relayTransitionResult.success) {
            throw new Error(`Failed to transition to relayed: ${relayTransitionResult.error}`)
          }
          logger.info('Status transition', {
            sponsorshipRequestId: requestId,
            relayTransactionId: relayTx.id,
            walletAddress,
            previousStatus: 'approved',
            newStatus: 'relayed',
          })
        } else {
          // Stale execution recovery (currentStatus === 'relayed')
          // Create new relay transaction with relayAttempt = previous count + 1 (Req 11.2)
          relayTx = await createRelayTransaction(tx as any, requestId)
          logger.info('Stale execution recovery — new relay transaction created', {
            sponsorshipRequestId: requestId,
            relayTransactionId: relayTx.id,
            walletAddress,
            relayAttempt: relayTx.relayAttempt,
          })
        }

        // Step 9: Update relay transaction to submitted with submittedAt timestamp
        const submitResult = await updateRelayTransaction(
          tx as any,
          relayTx.id,
          'submitted'
        )
        if (!submitResult.success) {
          throw new Error(`Failed to update relay TX to submitted: ${submitResult.error}`)
        }

        // Step 10: Invoke relay executor
        logger.info('Invoking relay executor', {
          sponsorshipRequestId: requestId,
          relayTransactionId: relayTx.id,
          walletAddress,
          relayAttempt: relayTx.relayAttempt,
          maxRetries: config.maxRetries,
        })

        const relayExecResult: RelayResult = await executeRelay(requestId, relayTx.id, relayTx.relayAttempt)

        // Step 11: Handle relay result
        if (relayExecResult.success) {
          // Log block number if available
          if (relayExecResult.blockNumber != null) {
            logger.info('Relay confirmed with block number', {
              sponsorshipRequestId: requestId,
              relayTransactionId: relayTx.id,
              walletAddress,
              transactionHash: relayExecResult.transactionHash,
              blockNumber: relayExecResult.blockNumber.toString(),
            })
          }

          // Update relay TX to confirmed with transaction hash, event data, and explorerUrl
          const confirmResult = await updateRelayTransaction(
            tx as any,
            relayTx.id,
            'confirmed',
            {
              transactionHash: relayExecResult.transactionHash!,
              blockNumber: relayExecResult.blockNumber ?? null,
              eventName: 'SponsorshipGranted',
              eventData: relayExecResult.eventData ?? null,
              explorerUrl: relayExecResult.explorerUrl ?? null,
            }
          )
          if (!confirmResult.success) {
            throw new Error(`Failed to update relay TX to confirmed: ${confirmResult.error}`)
          }

          // Transition relayed → completed
          const completeResult = await transitionSponsorshipStatus(
            tx as any,
            requestId,
            'completed'
          )
          if (!completeResult.success) {
            throw new Error(`Failed to transition to completed: ${completeResult.error}`)
          }

          // Increment wallet sponsorshipCount
          await (tx as any).wallet.update({
            where: { id: walletId },
            data: { sponsorshipCount: { increment: 1 } },
          })

          logger.info('Status transition', {
            sponsorshipRequestId: requestId,
            relayTransactionId: relayTx.id,
            walletAddress,
            previousStatus: 'relayed',
            newStatus: 'completed',
          })

          return {
            requestId,
            success: true,
            finalStatus: 'completed' as SponsorshipStatusValue,
          }
        } else if (isAlreadySponsoredError(relayExecResult.failureReason)) {
          // AlreadySponsored: treat as success — wallet already received sponsorship on-chain
          const confirmResult = await updateRelayTransaction(
            tx as any,
            relayTx.id,
            'confirmed',
            {
              transactionHash: relayExecResult.transactionHash ?? undefined,
              blockNumber: relayExecResult.blockNumber ?? null,
              explorerUrl: relayExecResult.explorerUrl ?? null,
            }
          )
          if (!confirmResult.success) {
            throw new Error(`Failed to update relay TX to confirmed (AlreadySponsored): ${confirmResult.error}`)
          }

          // Transition relayed → completed
          const completeResult = await transitionSponsorshipStatus(
            tx as any,
            requestId,
            'completed'
          )
          if (!completeResult.success) {
            throw new Error(`Failed to transition to completed (AlreadySponsored): ${completeResult.error}`)
          }

          // Increment wallet sponsorshipCount
          await (tx as any).wallet.update({
            where: { id: walletId },
            data: { sponsorshipCount: { increment: 1 } },
          })

          logger.info('AlreadySponsored — treated as completed with count increment', {
            sponsorshipRequestId: requestId,
            relayTransactionId: relayTx.id,
            walletAddress,
            failureReason: relayExecResult.failureReason,
            previousStatus: 'relayed',
            newStatus: 'completed',
          })

          return {
            requestId,
            success: true,
            finalStatus: 'completed' as SponsorshipStatusValue,
          }
        } else {
          // Other failure: update relay TX to failed with failure reason
          const failRelayResult = await updateRelayTransaction(
            tx as any,
            relayTx.id,
            'failed',
            { failureReason: relayExecResult.failureReason! }
          )
          if (!failRelayResult.success) {
            throw new Error(`Failed to update relay TX to failed: ${failRelayResult.error}`)
          }

          // Transition relayed → failed
          const failResult = await transitionSponsorshipStatus(
            tx as any,
            requestId,
            'failed'
          )
          if (!failResult.success) {
            throw new Error(`Failed to transition to failed: ${failResult.error}`)
          }
          logger.info('Status transition', {
            sponsorshipRequestId: requestId,
            relayTransactionId: relayTx.id,
            walletAddress,
            previousStatus: 'relayed',
            newStatus: 'failed',
            failureReason: relayExecResult.failureReason,
          })

          return {
            requestId,
            success: true,
            finalStatus: 'failed' as SponsorshipStatusValue,
          }
        }
      },
      {
        timeout: config.lockTimeoutMs,
      }
    )

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const truncatedMessage = message.length > 1000 ? message.slice(0, 997) + '...' : message
    logger.error('Error processing request', {
      sponsorshipRequestId: requestId,
      error: truncatedMessage,
      relayStage: 'processor',
      elapsedMs: Date.now() - processorStartTime,
    })

    return {
      requestId,
      success: false,
      finalStatus: 'pending' as SponsorshipStatusValue,
      error: message,
    }
  }
}
