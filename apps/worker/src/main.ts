import { start, stop } from './worker.js'
import { loadConfig } from './config.js'
import { createLogger } from './logger.js'

const logger = createLogger('worker')

// Register signal handlers
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

let isShuttingDown = false

async function shutdown(): Promise<void> {
  if (isShuttingDown) return
  isShuttingDown = true

  logger.info('Shutdown signal received')

  const config = loadConfig()

  const timeout = setTimeout(() => {
    logger.warn(
      'Shutdown timed out, in-progress relay may need manual reconciliation',
      { timeoutMs: config.shutdownTimeoutMs }
    )
    process.exit(1)
  }, config.shutdownTimeoutMs)

  try {
    await stop()
    clearTimeout(timeout)
    process.exit(0)
  } catch (error) {
    clearTimeout(timeout)
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Error during shutdown', { error: message })
    process.exit(1)
  }
}

// Start the worker
start().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  logger.error('Failed to start worker', { error: message })
  process.exit(1)
})
