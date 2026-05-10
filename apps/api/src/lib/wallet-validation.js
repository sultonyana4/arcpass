import { ValidationError } from './errors.js'

const WALLET_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/

/**
 * Validates that a string matches the Ethereum address format.
 * Trims whitespace before testing.
 * @param {string} address - The wallet address to validate
 * @returns {boolean} true if the address matches /^0x[0-9a-fA-F]{40}$/
 */
export function isValidWalletAddress(address) {
  if (typeof address !== 'string') {
    return false
  }
  return WALLET_ADDRESS_REGEX.test(address.trim())
}

/**
 * Normalizes a wallet address to lowercase.
 * Trims whitespace and lowercases the entire string.
 * @param {string} address - The wallet address to normalize
 * @returns {string} The normalized (lowercase) wallet address
 * @throws {ValidationError} if address is not a valid wallet address
 */
export function normalizeWalletAddress(address) {
  if (typeof address !== 'string') {
    throw new ValidationError('Wallet address must be a string')
  }

  const trimmed = address.trim()

  if (!WALLET_ADDRESS_REGEX.test(trimmed)) {
    throw new ValidationError(
      'Invalid wallet address format. Expected 0x followed by 40 hexadecimal characters'
    )
  }

  return trimmed.toLowerCase()
}
