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
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Step 1: Acquire row-level lock via SELECT FOR UPDATE SKIP LOCKED
        const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
          SELECT id, status FROM "sponsorship_requests"
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

        // Only process requests that are in 'pending' status
        if (currentStatus !== 'pending') {
          logger.info('Skipping request — not in pending status', {
            requestId,
            currentStatus,
          })
          return {
            requestId,
            success: true,
            finalStatus: currentStatus,
            error: `Request is in "${currentStatus}" status — skipped`,
          }
        }

        // Step 2: Check retry count — enforce max retry limit
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
            requestId,
            retryCount,
            maxRetries: config.maxRetries,
            previousStatus: 'pending',
            newStatus: 'failed',
          })
          return {
            requestId,
            success: true,
            finalStatus: 'failed' as SponsorshipStatusValue,
          }
        }

        // Step 3: Guard — check for existing submitted or confirmed RelayTransaction
        const existingActiveRelay = await (tx as any).relayTransaction.findFirst({
          where: {
            sponsorshipRequestId: requestId,
            status: { in: ['submitted', 'confirmed'] },
          },
        })

        if (existingActiveRelay) {
          logger.info('Skipping relay — active relay transaction already exists', {
            requestId,
            existingRelayId: existingActiveRelay.id,
            existingRelayStatus: existingActiveRelay.status,
          })
          return {
            requestId,
            success: true,
            finalStatus: currentStatus,
            error: `Active relay transaction already exists (status: ${existingActiveRelay.status}) — skipped`,
          }
        }

        // Step 4: Transition pending → approved
        const approveResult = await transitionSponsorshipStatus(
          tx as any,
          requestId,
          'approved'
        )
        if (!approveResult.success) {
          throw new Error(`Failed to transition to approved: ${approveResult.error}`)
        }
        logger.info('Status transition', {
          requestId,
          previousStatus: 'pending',
          newStatus: 'approved',
        })

        // Step 5: Create relay transaction
        const relayTx = await createRelayTransaction(tx as any, requestId)

        // Step 6: Transition approved → relayed
        const relayTransitionResult = await transitionSponsorshipStatus(
          tx as any,
          requestId,
          'relayed'
        )
        if (!relayTransitionResult.success) {
          throw new Error(`Failed to transition to relayed: ${relayTransitionResult.error}`)
        }
        logger.info('Status transition', {
          requestId,
          previousStatus: 'approved',
          newStatus: 'relayed',
        })

        // Step 7: Update relay transaction to submitted with submittedAt timestamp
        const submitResult = await updateRelayTransaction(
          tx as any,
          relayTx.id,
          'submitted'
        )
        if (!submitResult.success) {
          throw new Error(`Failed to update relay TX to submitted: ${submitResult.error}`)
        }

        // Step 8: Invoke relay executor
        logger.info('Invoking relay executor', {
          requestId,
          relayAttempt: relayTx.relayAttempt,
          maxRetries: config.maxRetries,
        })

        const relayExecResult: RelayResult = await executeRelay(requestId)

        // Step 9: Handle relay result
        if (relayExecResult.success) {
          // Log block number if available
          if (relayExecResult.blockNumber != null) {
            logger.info('Relay confirmed with block number', {
              requestId,
              transactionHash: relayExecResult.transactionHash,
              blockNumber: relayExecResult.blockNumber.toString(),
            })
          }

          // Update relay TX to confirmed with transaction hash
          const confirmResult = await updateRelayTransaction(
            tx as any,
            relayTx.id,
            'confirmed',
            { transactionHash: relayExecResult.transactionHash! }
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
          logger.info('Status transition', {
            requestId,
            previousStatus: 'relayed',
            newStatus: 'completed',
          })

          return {
            requestId,
            success: true,
            finalStatus: 'completed' as SponsorshipStatusValue,
          }
        } else {
          // Update relay TX to failed with failure reason
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
            requestId,
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
    logger.error('Error processing request', {
      requestId,
      error: message,
    })

    return {
      requestId,
      success: false,
      finalStatus: 'pending' as SponsorshipStatusValue,
      error: message,
    }
  }
}
