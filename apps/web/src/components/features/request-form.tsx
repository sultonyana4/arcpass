"use client"

import { useState, useEffect, useRef, useCallback } from 'react'
import { FormInput } from '@/components/ui/form-input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  createSponsorshipRequest,
  getSponsorshipStatus,
  validateWalletAddress,
  ApiError,
  NetworkError,
} from '@/lib/api-client'
import { config } from '@/config/env'
import type { SponsorshipDetailResponse } from '@/types/api'
import type { ValidationState } from '@/types/components'

const POLLING_INTERVAL_MS = 3000
const MAX_POLLING_RETRIES = 3
const TERMINAL_STATUSES = ['completed', 'failed', 'rejected'] as const

type RequestState = 'idle' | 'loading' | 'success' | 'error'

function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status)
}

export function RequestForm() {
  const [walletAddress, setWalletAddress] = useState('')
  const [validationState, setValidationState] = useState<ValidationState>('idle')
  const [validationError, setValidationError] = useState<string | undefined>(undefined)

  const [requestState, setRequestState] = useState<RequestState>('idle')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [sponsorship, setSponsorship] = useState<SponsorshipDetailResponse | null>(null)

  const [isPolling, setIsPolling] = useState(false)
  const [pollingRetries, setPollingRetries] = useState(0)
  const [pollingError, setPollingError] = useState<string | null>(null)
  const [showManualRetry, setShowManualRetry] = useState(false)

  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null)
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null)

  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const retriesRef = useRef(0)
  const submitInFlightRef = useRef(false)

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [])

  const handleAddressChange = useCallback((value: string) => {
    setWalletAddress(value)

    if (value === '') {
      setValidationState('idle')
      setValidationError(undefined)
    } else if (validateWalletAddress(value)) {
      setValidationState('valid')
      setValidationError(undefined)
    } else {
      setValidationState('invalid')
      setValidationError('Invalid wallet address. Must be 0x followed by 40 hex characters.')
    }
  }, [])

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
    setIsPolling(false)
  }, [])

  const pollStatus = useCallback(async (id: string) => {
    try {
      const detail = await getSponsorshipStatus(id)
      setSponsorship(detail)
      setPollingError(null)
      setShowManualRetry(false)
      retriesRef.current = 0
      setPollingRetries(0)

      if (isTerminalStatus(detail.status)) {
        stopPolling()
      }
    } catch (error: unknown) {
      if (error instanceof NetworkError) {
        retriesRef.current += 1
        setPollingRetries(retriesRef.current)

        if (retriesRef.current >= MAX_POLLING_RETRIES) {
          stopPolling()
          setPollingError('Unable to reach the server. Please check your connection.')
          setShowManualRetry(true)
        }
      } else {
        // For non-network errors, stop polling and show error
        stopPolling()
        setPollingError(
          error instanceof ApiError
            ? error.message
            : 'An unexpected error occurred while checking status.',
        )
        setShowManualRetry(true)
      }
    }
  }, [stopPolling])

  const startPolling = useCallback((id: string) => {
    setIsPolling(true)
    setPollingError(null)
    setShowManualRetry(false)
    retriesRef.current = 0
    setPollingRetries(0)

    // Immediately poll once
    pollStatus(id)

    // Then set up interval
    pollingIntervalRef.current = setInterval(() => {
      pollStatus(id)
    }, POLLING_INTERVAL_MS)
  }, [pollStatus])

  const handleManualRetry = useCallback(() => {
    if (requestId) {
      startPolling(requestId)
    }
  }, [requestId, startPolling])

  // Check if currently rate-limited
  const isRateLimited = rateLimitUntil !== null && Date.now() < rateLimitUntil

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Guard: prevent duplicate in-flight requests
    if (submitInFlightRef.current) return

    // Guard: block submission during rate limit cooldown
    if (isRateLimited) return

    // Validate before submit
    if (!validateWalletAddress(walletAddress)) {
      setValidationState('invalid')
      setValidationError('Invalid wallet address. Must be 0x followed by 40 hex characters.')
      return
    }

    submitInFlightRef.current = true
    setRequestState('loading')
    setValidationError(undefined)
    setRateLimitMessage(null)
    setPollingError(null)
    setShowManualRetry(false)

    try {
      const response = await createSponsorshipRequest(walletAddress)
      setRequestId(response.id)
      setSponsorship(null)
      setRequestState('success')
      startPolling(response.id)
    } catch (error: unknown) {
      setRequestState('error')
      if (error instanceof ApiError) {
        if (error.statusCode === 400) {
          setValidationState('invalid')
          setValidationError(error.message)
        } else if (error.statusCode === 429) {
          // Extract retry-after from the error message or use a default
          const retryMatch = error.message.match(/(\d+)/)
          const retrySeconds = retryMatch ? parseInt(retryMatch[1], 10) : 60
          setRateLimitMessage(
            `Rate limited. Please try again in ${retrySeconds} seconds.`,
          )
          // Block submissions for the cooldown period
          setRateLimitUntil(Date.now() + retrySeconds * 1000)
        } else {
          setValidationState('invalid')
          setValidationError(error.message)
        }
      } else if (error instanceof NetworkError) {
        setValidationState('invalid')
        setValidationError('Network error. Please check your connection and try again.')
      }
    } finally {
      submitInFlightRef.current = false
    }
  }

  const isSubmitDisabled =
    requestState === 'loading' ||
    validationState === 'invalid' ||
    isRateLimited

  // Find the latest relay transaction with a hash
  const relayTxHash = sponsorship?.relayTransactions?.find(
    (tx) => tx.transactionHash !== null,
  )?.transactionHash

  return (
    <div className="w-full max-w-lg space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormInput
          label="Wallet Address"
          name="walletAddress"
          placeholder="0x..."
          value={walletAddress}
          onChange={handleAddressChange}
          validationState={validationState}
          errorMessage={validationError}
        />

        {rateLimitMessage && (
          <p role="alert" className="text-sm text-amber-400">
            {rateLimitMessage}
          </p>
        )}

        <Button
          type="submit"
          loading={requestState === 'loading'}
          disabled={isSubmitDisabled}
        >
          Request Sponsorship
        </Button>
      </form>

      {requestId && (
        <div className="space-y-4 rounded-lg border border-[var(--color-background-border)] bg-[var(--color-background-elevated)] p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--color-foreground-secondary)]">
              Request ID
            </p>
            <p className="font-mono text-sm text-[var(--color-foreground)]">
              {requestId}
            </p>
          </div>

          {sponsorship && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-[var(--color-foreground-secondary)]">
                Status
              </p>
              <Badge status={sponsorship.status} />
            </div>
          )}

          {isPolling && !pollingError && (
            <p role="status" aria-live="polite" className="text-xs text-[var(--color-foreground-secondary)]">
              Polling for updates
              {pollingRetries > 0 && ` (retry ${pollingRetries}/${MAX_POLLING_RETRIES})`}
              …
            </p>
          )}

          {pollingError && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-red-400">
                {pollingError}
              </p>
              {showManualRetry && (
                <Button variant="secondary" onClick={handleManualRetry} aria-label="Retry polling for sponsorship status">
                  Retry
                </Button>
              )}
            </div>
          )}

          {relayTxHash && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-[var(--color-foreground-secondary)]">
                Transaction
              </p>
              <a
                href={`${config.explorerUrl}${relayTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`View transaction ${relayTxHash.slice(0, 10)} on block explorer (opens in new tab)`}
                className="font-mono text-sm text-[var(--color-accent)] hover:underline"
              >
                {relayTxHash.slice(0, 10)}…{relayTxHash.slice(-8)}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
