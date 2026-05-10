/**
 * End-to-End Validation Script for ArcPass Sponsored Execution
 *
 * Exercises the full sponsorship flow against Arc testnet:
 * 1. Creates a sponsorship request via the API
 * 2. Polls until completion or failure
 * 3. Verifies the transaction on-chain via eth_getTransactionReceipt
 * 4. Outputs a summary with explorer URL
 *
 * Run: npx tsx scripts/validate-e2e.ts
 *
 * Environment variables:
 *   API_BASE_URL             - Base URL for the sponsorship API (e.g. http://localhost:3000)
 *   CHAIN_RPC_URL            - Arc testnet RPC endpoint
 *   VALIDATION_WALLET_ADDRESS - Target wallet address (0x-prefixed, 40 hex chars)
 *   VALIDATION_TIMEOUT_MS    - Polling timeout in ms (default: 120000)
 */

interface ValidationConfig {
  apiBaseUrl: string
  rpcUrl: string
  walletAddress: string
  pollIntervalMs: number
  timeoutMs: number
}

interface SponsorshipResponse {
  id: string
  status: string
  transactionHash?: string
  explorerUrl?: string
  failureReason?: string
}

function loadConfig(): ValidationConfig {
  const apiBaseUrl = process.env.API_BASE_URL
  if (!apiBaseUrl) {
    process.stderr.write('Error: API_BASE_URL environment variable is required\n')
    process.exit(1)
  }

  const rpcUrl = process.env.CHAIN_RPC_URL
  if (!rpcUrl) {
    process.stderr.write('Error: CHAIN_RPC_URL environment variable is required\n')
    process.exit(1)
  }

  const walletAddress = process.env.VALIDATION_WALLET_ADDRESS
  if (!walletAddress) {
    process.stderr.write('Error: VALIDATION_WALLET_ADDRESS environment variable is required\n')
    process.exit(1)
  }

  const normalizedWallet = walletAddress.toLowerCase()
  const walletPattern = /^0x[0-9a-f]{40}$/
  if (!walletPattern.test(normalizedWallet)) {
    process.stderr.write(
      `Error: VALIDATION_WALLET_ADDRESS must be a valid Ethereum address (0x + 40 hex chars), got: ${walletAddress}\n`
    )
    process.exit(1)
  }

  const timeoutMs = process.env.VALIDATION_TIMEOUT_MS
    ? parseInt(process.env.VALIDATION_TIMEOUT_MS, 10)
    : 120000

  if (isNaN(timeoutMs) || timeoutMs <= 0) {
    process.stderr.write('Error: VALIDATION_TIMEOUT_MS must be a positive integer\n')
    process.exit(1)
  }

  return {
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ''),
    rpcUrl,
    walletAddress: normalizedWallet,
    pollIntervalMs: 2000,
    timeoutMs,
  }
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function isValidTxHash(value: string): boolean {
  return /^0x[0-9a-f]{64}$/.test(value)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createSponsorshipRequest(
  config: ValidationConfig
): Promise<{ id: string; status: string }> {
  const url = `${config.apiBaseUrl}/sponsorship/request`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: config.walletAddress }),
  })

  if (response.status !== 201) {
    const body = await response.text()
    process.stderr.write(
      `Error: POST /sponsorship/request returned HTTP ${response.status}\n${body}\n`
    )
    process.exit(1)
  }

  const data = await response.json()

  if (!data.id || !isValidUuid(data.id)) {
    process.stderr.write(
      `Error: Response missing valid UUID 'id' field. Got: ${JSON.stringify(data)}\n`
    )
    process.exit(1)
  }

  if (data.status !== 'pending') {
    process.stderr.write(
      `Error: Expected status 'pending', got '${data.status}'\n`
    )
    process.exit(1)
  }

  return { id: data.id, status: data.status }
}

async function pollSponsorshipStatus(
  config: ValidationConfig,
  requestId: string
): Promise<SponsorshipResponse> {
  const startTime = Date.now()
  let lastStatus = 'pending'

  while (true) {
    const elapsed = Date.now() - startTime
    if (elapsed >= config.timeoutMs) {
      process.stderr.write(
        `Error: Polling timeout after ${config.timeoutMs}ms. Last status: '${lastStatus}'\n`
      )
      process.exit(1)
    }

    await sleep(config.pollIntervalMs)

    const url = `${config.apiBaseUrl}/sponsorship/${requestId}`
    const response = await fetch(url)

    if (!response.ok) {
      process.stderr.write(
        `Warning: GET /sponsorship/${requestId} returned HTTP ${response.status}, retrying...\n`
      )
      continue
    }

    const data: SponsorshipResponse = await response.json()
    lastStatus = data.status

    if (data.status === 'completed' || data.status === 'failed') {
      return data
    }
  }
}

async function verifyOnChain(
  rpcUrl: string,
  transactionHash: string
): Promise<{ blockNumber: string; status: string }> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getTransactionReceipt',
      params: [transactionHash],
      id: 1,
    }),
  })

  if (!response.ok) {
    process.stderr.write(
      `Error: RPC request failed with HTTP ${response.status}\n`
    )
    process.exit(1)
  }

  const rpcResponse = await response.json()

  if (rpcResponse.error) {
    process.stderr.write(
      `Error: RPC error: ${JSON.stringify(rpcResponse.error)}\n`
    )
    process.exit(1)
  }

  const receipt = rpcResponse.result
  if (!receipt) {
    process.stderr.write(
      `Error: Transaction receipt not found for hash ${transactionHash}\n`
    )
    process.exit(1)
  }

  if (receipt.blockNumber == null) {
    process.stderr.write(
      `Error: Transaction receipt has null blockNumber (not yet mined)\n`
    )
    process.exit(1)
  }

  const statusHex = receipt.status
  const statusNum = parseInt(statusHex, 16)
  if (statusNum !== 1) {
    process.stderr.write(
      `Error: Transaction receipt status is ${statusHex} (expected 0x1 / success)\n`
    )
    process.exit(1)
  }

  return {
    blockNumber: receipt.blockNumber,
    status: statusHex,
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  const startTime = Date.now()

  console.log(`\n🚀 ArcPass E2E Validation`)
  console.log(`   Wallet:  ${config.walletAddress}`)
  console.log(`   API:     ${config.apiBaseUrl}`)
  console.log(`   RPC:     ${config.rpcUrl}`)
  console.log(`   Timeout: ${config.timeoutMs}ms\n`)

  // Step 1: Create sponsorship request
  console.log('1. Creating sponsorship request...')
  const { id: requestId } = await createSponsorshipRequest(config)
  console.log(`   ✓ Request created: ${requestId} (status: pending)`)

  // Step 2: Poll until terminal status
  console.log('2. Polling for completion...')
  const result = await pollSponsorshipStatus(config, requestId)

  // Step 3: Handle failed status
  if (result.status === 'failed') {
    process.stderr.write(
      `\n❌ Sponsorship request failed.\n   Reason: ${result.failureReason ?? 'unknown'}\n`
    )
    process.exit(1)
  }

  // Step 4: Verify completed result
  console.log(`   ✓ Request completed`)

  const txHash = result.transactionHash
  if (!txHash || !isValidTxHash(txHash)) {
    process.stderr.write(
      `Error: Invalid or missing transactionHash. Got: ${txHash}\n`
    )
    process.exit(1)
  }

  const explorerUrl = result.explorerUrl
  if (!explorerUrl || !explorerUrl.includes(txHash)) {
    process.stderr.write(
      `Error: explorerUrl missing or does not contain transaction hash.\n   explorerUrl: ${explorerUrl}\n   txHash: ${txHash}\n`
    )
    process.exit(1)
  }

  // Step 5: Verify on-chain
  console.log('3. Verifying transaction on-chain...')
  const receipt = await verifyOnChain(config.rpcUrl, txHash)
  const blockNumber = parseInt(receipt.blockNumber, 16)
  console.log(`   ✓ Transaction confirmed in block ${blockNumber}`)

  // Step 6: Output summary
  const elapsedMs = Date.now() - startTime
  const elapsedSec = (elapsedMs / 1000).toFixed(2)

  console.log(`\n✅ E2E Validation Passed`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`   Wallet:       ${config.walletAddress}`)
  console.log(`   Request ID:   ${requestId}`)
  console.log(`   Tx Hash:      ${txHash}`)
  console.log(`   Explorer URL: ${explorerUrl}`)
  console.log(`   Block Number: ${blockNumber}`)
  console.log(`   Elapsed:      ${elapsedSec}s`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
}

main().catch((err) => {
  process.stderr.write(`\n❌ Unexpected error: ${err.message}\n`)
  if (err.stack) {
    process.stderr.write(`${err.stack}\n`)
  }
  process.exit(1)
})
