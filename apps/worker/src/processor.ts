import { prisma, type SponsorshipStatusValue } from '@arcpass/shared'
import type { WorkerConfig } from './config.js'
import {
  transitionSponsorshipStatus,
  createRelayTransaction,
  updateRelayTransaction,
  getRetryCount,
} from './lifecycle.js'
import { simulateRelay } from './relay-simulator.js'

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
          console.info(
            `[processor] Request ${requestId} exceeded max retries (${retryCount}/${config.maxRetries}) — transitioned to failed`
          )
          return {
            requestId,
            success: true,
            finalStatus: 'failed' as SponsorshipStatusValue,
          }
        }

        // Step 3: Transition pending → approved
        const approveResult = await transitionSponsorshipStatus(
          tx as any,
          requestId,
          'approved'
        )
        if (!approveResult.success) {
          throw new Error(`Failed to transition to approved: ${approveResult.error}`)
        }

        // Step 4: Create relay transaction
        const relayTx = await createRelayTransaction(tx as any, requestId)

        // Step 5: Transition approved → relayed
        const relayResult = await transitionSponsorshipStatus(
          tx as any,
          requestId,
          'relayed'
        )
        if (!relayResult.success) {
          throw new Error(`Failed to transition to relayed: ${relayResult.error}`)
        }

        // Step 6: Update relay transaction to submitted
        const submitResult = await updateRelayTransaction(
          tx as any,
          relayTx.id,
          'submitted'
        )
        if (!submitResult.success) {
          throw new Error(`Failed to update relay TX to submitted: ${submitResult.error}`)
        }

        // Step 7: Invoke relay simulator
        const relaySimResult = await simulateRelay(requestId, config.relayFailureRate)

        // Step 8: Handle relay result
        if (relaySimResult.success) {
          // Update relay TX to confirmed with transaction hash
          const confirmResult = await updateRelayTransaction(
            tx as any,
            relayTx.id,
            'confirmed',
            { transactionHash: relaySimResult.transactionHash! }
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
            { failureReason: relaySimResult.failureReason! }
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
    console.error(`[processor] Error processing request ${requestId}: ${message}`)

    return {
      requestId,
      success: false,
      finalStatus: 'pending' as SponsorshipStatusValue,
      error: message,
    }
  }
}
