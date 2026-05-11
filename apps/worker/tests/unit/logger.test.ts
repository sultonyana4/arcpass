import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogger, filterSensitiveData } from '../../src/logger.js'

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

  describe('max recursion depth', () => {
    it('replaces objects beyond max depth (10 levels) with [REDACTED]', () => {
      // Build a deeply nested object (11 levels deep)
      let nested: Record<string, unknown> = { value: 'deep' }
      for (let i = 0; i < 11; i++) {
        nested = { level: nested }
      }

      const result = filterSensitiveData(nested)
      // Navigate 9 levels deep (0-indexed depth 0..9 = 10 levels)
      let current: any = result
      for (let i = 0; i < 9; i++) {
        expect(typeof current.level).toBe('object')
        current = current.level
      }
      // At depth 10, the object should be replaced with [REDACTED]
      expect(current.level).toBe('[REDACTED]')
    })

    it('allows objects at exactly depth 9 (10th level of nesting)', () => {
      // Build exactly 10 levels deep
      let nested: Record<string, unknown> = { value: 'deep' }
      for (let i = 0; i < 9; i++) {
        nested = { level: nested }
      }

      const result = filterSensitiveData(nested)
      // Navigate to the deepest level
      let current: any = result
      for (let i = 0; i < 8; i++) {
        expect(typeof current.level).toBe('object')
        current = current.level
      }
      // At depth 9, the innermost object should still be processed
      expect(current.level).toEqual({ value: 'deep' })
    })

    it('respects custom maxDepth parameter', () => {
      const data = { a: { b: { c: { d: 'value' } } } }
      const result = filterSensitiveData(data, 2)
      expect(result.a).toEqual({ b: '[REDACTED]' })
    })

    it('still redacts sensitive keys at any depth before max', () => {
      const data = { level1: { level2: { password: 'secret123' } } }
      const result = filterSensitiveData(data)
      expect((result.level1 as any).level2.password).toBe('[REDACTED]')
    })
  })

  describe('message truncation', () => {
    it('truncates messages longer than 10,000 characters', () => {
      const logger = createLogger('worker')
      const longMessage = 'x'.repeat(15_000)
      logger.info(longMessage)

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.message.length).toBe(10_000)
    })

    it('does not truncate messages at exactly 10,000 characters', () => {
      const logger = createLogger('worker')
      const exactMessage = 'y'.repeat(10_000)
      logger.info(exactMessage)

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.message.length).toBe(10_000)
      expect(entry.message).toBe(exactMessage)
    })

    it('does not truncate messages shorter than 10,000 characters', () => {
      const logger = createLogger('worker')
      const shortMessage = 'hello world'
      logger.info(shortMessage)

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.message).toBe(shortMessage)
    })
  })

  describe('credential URL pattern', () => {
    it('redacts http://user:pass@host URLs', () => {
      const logger = createLogger('worker')
      logger.info('connecting', { url: 'http://admin:password123@db.example.com:5432/mydb' })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.url).toBe('[REDACTED_URL]')
    })

    it('redacts https://user:pass@host URLs', () => {
      const logger = createLogger('worker')
      logger.info('connecting', { url: 'https://user:p%40ss@rpc.example.com/v1' })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.url).toBe('[REDACTED_URL]')
    })

    it('redacts URLs with special characters in password', () => {
      const logger = createLogger('worker')
      logger.info('connecting', { url: 'https://user:p@ss!word@host.com' })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.url).toBe('[REDACTED_URL]')
    })

    it('redacts URLs with numeric user and pass', () => {
      const logger = createLogger('worker')
      logger.info('connecting', { url: 'http://123:456@localhost:3000' })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.url).toBe('[REDACTED_URL]')
    })

    it('does not redact URLs without credentials', () => {
      const logger = createLogger('worker')
      logger.info('connecting', { url: 'https://rpc.example.com/v1' })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.url).toBe('https://rpc.example.com/v1')
    })

    it('does not redact URLs with only a user (no password)', () => {
      const logger = createLogger('worker')
      logger.info('connecting', { url: 'https://user@host.com' })

      const entry = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(entry.url).toBe('https://user@host.com')
    })
  })
})
