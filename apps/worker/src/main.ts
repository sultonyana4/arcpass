import { start, stop } from './worker.js'

// Register signal handlers
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

let isShuttingDown = false

async function shutdown(): Promise<void> {
  if (isShuttingDown) return
  isShuttingDown = true

  console.info('[main] Shutdown signal received')

  const timeout = setTimeout(() => {
    console.error('[main] Shutdown timed out after 10 seconds')
    process.exit(1)
  }, 10000)

  try {
    await stop()
    clearTimeout(timeout)
    process.exit(0)
  } catch (error) {
    clearTimeout(timeout)
    console.error('[main] Error during shutdown:', error)
    process.exit(1)
  }
}

// Start the worker
start().catch((error) => {
  console.error('[main] Failed to start worker:', error)
  process.exit(1)
})
