export class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class BlockedWalletError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BlockedWalletError'
  }
}

export class WalletNotFoundError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WalletNotFoundError'
  }
}

export class SponsorshipNotFoundError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SponsorshipNotFoundError'
  }
}

export class RateLimitError extends Error {
  constructor(message, { retryAfter } = {}) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter || null
  }
}

export class InvalidStatusTransitionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'InvalidStatusTransitionError'
  }
}
