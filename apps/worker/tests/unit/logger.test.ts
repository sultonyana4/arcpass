import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogger } from '../../src/logger.js'

describe('logger', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  describe('createLogger', () => {
    it('creates a logger with the specified component', () => {
      const logger = createLogger('worker')
      logger.info('test message')

      expect(stdoutSpy).toHaveBeenCalledOnce()
      const output = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(output.component).toBe('worker')
    })

    it('returns a logger with info, warn, and error methods', () => {
      const logger = createLogger('processor')
      expect(typeof logger.info).toBe('function')
      expect(typeof logger.warn).toBe('function')
      expect(typeof logger.error).toBe('function')
    })
  })

  describe('log output format', () => {
    it('outputs single-line JSON with required fields', () => {
      const logger = createLogger('relay-executor')
      logger.info('transaction broadcast')

      expect(stdoutSpy).toHaveBeenCalledOnce()
      const raw = stdoutSpy.mock.calls[0][0] as string

      // Single line (ends with \n, no other newlines)
      expect(raw.split('\n').filter(Boolean)).toHaveLength(1)

      const entry = JSON.parse(raw)
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(entry.level).toBe('info')
      expect(entry.component).toBe('relay-executor')
      expect(entry.message).toBe('transaction broadcast')
    })

    it('includes additional data fields in the output', () => {
      const logger = createLogger('poller')
      logger.info('batch processed', { batchSize: 5, duration: 120 })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.batchSize).toBe(5)
      expect(entry.duration).toBe(120)
    })

    it('writes info logs to stdout', () => {
      const logger = createLogger('worker')
      logger.info('info message')

      expect(stdoutSpy).toHaveBeenCalledOnce()
      expect(stderrSpy).not.toHaveBeenCalled()
    })

    it('writes warn logs to stdout', () => {
      const logger = createLogger('worker')
      logger.warn('warning message')

      expect(stdoutSpy).toHaveBeenCalledOnce()
      expect(stderrSpy).not.toHaveBeenCalled()
    })

    it('writes error logs to stderr', () => {
      const logger = createLogger('worker')
      logger.error('error message')

      expect(stderrSpy).toHaveBeenCalledOnce()
      expect(stdoutSpy).not.toHaveBeenCalled()
    })

    it('sets the correct level for each method', () => {
      const logger = createLogger('processor')

      logger.info('info')
      logger.warn('warn')
      logger.error('error')

      const infoEntry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      const warnEntry = JSON.parse(stdoutSpy.mock.calls[1][0] as string)
      const errorEntry = JSON.parse(stderrSpy.mock.calls[0][0] as string)

      expect(infoEntry.level).toBe('info')
      expect(warnEntry.level).toBe('warn')
      expect(errorEntry.level).toBe('error')
    })
  })

  describe('sensitive data filtering', () => {
    it('redacts fields matching privateKey pattern', () => {
      const logger = createLogger('worker')
      logger.info('config loaded', { privateKey: '0xabc123def456' })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.privateKey).toBe('[REDACTED]')
    })

    it('redacts fields matching private_key pattern', () => {
      const logger = createLogger('worker')
      logger.info('config loaded', { private_key: '0xabc123def456' })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.private_key).toBe('[REDACTED]')
    })

    it('redacts fields matching mnemonic pattern', () => {
      const logger = createLogger('worker')
      logger.info('wallet info', { mnemonic: 'word1 word2 word3' })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.mnemonic).toBe('[REDACTED]')
    })

    it('redacts fields matching secret pattern', () => {
      const logger = createLogger('worker')
      logger.info('config', { apiSecret: 'supersecret123' })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.apiSecret).toBe('[REDACTED]')
    })

    it('redacts fields matching password pattern', () => {
      const logger = createLogger('worker')
      logger.info('config', { password: 'hunter2' })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.password).toBe('[REDACTED]')
    })

    it('redacts fields matching credential pattern', () => {
      const logger = createLogger('worker')
      logger.info('auth', { credential: 'token123' })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.credential).toBe('[REDACTED]')
    })

    it('redacts fields matching authorization pattern', () => {
      const logger = createLogger('worker')
      logger.info('request', { authorization: 'Bearer xyz' })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.authorization).toBe('[REDACTED]')
    })

    it('redacts credential-bearing URLs', () => {
      const logger = createLogger('worker')
      logger.info('connecting', { rpcUrl: 'https://user:pass@rpc.example.com/v1' })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.rpcUrl).toBe('[REDACTED_URL]')
    })

    it('does not redact non-credential URLs', () => {
      const logger = createLogger('worker')
      logger.info('connecting', { rpcUrl: 'https://rpc.example.com/v1' })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.rpcUrl).toBe('https://rpc.example.com/v1')
    })

    it('recursively filters nested objects', () => {
      const logger = createLogger('worker')
      logger.info('nested', {
        config: { sponsorPrivateKey: '0xdeadbeef', url: 'https://safe.com' },
      })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.config.sponsorPrivateKey).toBe('[REDACTED]')
      expect(entry.config.url).toBe('https://safe.com')
    })

    it('preserves non-sensitive fields', () => {
      const logger = createLogger('relay-executor')
      logger.info('relay complete', {
        requestId: 'abc-123',
        txHash: '0x1234',
        blockNumber: 42,
      })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.requestId).toBe('abc-123')
      expect(entry.txHash).toBe('0x1234')
      expect(entry.blockNumber).toBe(42)
    })
  })
})
