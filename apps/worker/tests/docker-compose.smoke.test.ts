import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Smoke tests for Docker Compose worker service definition.
 * These tests parse docker-compose.yml as text and assert on its structure.
 * No Docker engine required.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */

interface ComposeService {
  build?: { context?: string; dockerfile?: string }
  depends_on?: Record<string, { condition?: string }>
  environment?: Record<string, string | number>
  restart?: string
  image?: string
  ports?: string[]
  volumes?: string[]
  healthcheck?: Record<string, unknown>
}

interface ComposeFile {
  services: Record<string, ComposeService>
  volumes?: Record<string, unknown>
}

/**
 * Minimal YAML parser for docker-compose.yml structure.
 * Handles the subset of YAML used in compose files (mappings, scalars, sequences).
 */
function parseSimpleYaml(content: string): ComposeFile {
  const lines = content.split('\n')
  const result: Record<string, unknown> = {}
  const stack: { indent: number; obj: Record<string, unknown>; key?: string }[] = [
    { indent: -1, obj: result },
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Skip empty lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) continue

    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()

    // Pop stack to find parent at correct indentation
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    const parent = stack[stack.length - 1].obj

    if (trimmed.startsWith('- ')) {
      // Array item
      const parentKey = stack[stack.length - 1].key
      if (parentKey && parent[parentKey] === undefined) {
        parent[parentKey] = []
      }
      const arr = parent[stack[stack.length - 1].key!] as unknown[]
      const value = trimmed.slice(2).trim()
      if (value.startsWith('"') && value.endsWith('"')) {
        arr.push(value.slice(1, -1))
      } else {
        arr.push(value)
      }
    } else if (trimmed.includes(':')) {
      const colonIdx = trimmed.indexOf(':')
      const key = trimmed.slice(0, colonIdx).trim()
      const rawValue = trimmed.slice(colonIdx + 1).trim()

      if (rawValue === '' || rawValue === '|' || rawValue === '>') {
        // Nested object
        const newObj: Record<string, unknown> = {}
        parent[key] = newObj
        stack.push({ indent, obj: newObj, key })
      } else {
        // Scalar value
        let value: string | number = rawValue
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1)
        }
        // Try to parse as number if it looks like one
        if (/^\d+$/.test(String(value))) {
          value = parseInt(String(value), 10)
        }
        parent[key] = value
        stack.push({ indent, obj: parent, key })
      }
    }
  }

  return result as unknown as ComposeFile
}

describe('Docker Compose worker service smoke tests', () => {
  let composeContent: string
  let compose: ComposeFile

  beforeAll(() => {
    const composePath = resolve(__dirname, '..', '..', '..', 'docker-compose.yml')
    composeContent = readFileSync(composePath, 'utf-8')
    compose = parseSimpleYaml(composeContent)
  })

  describe('worker service exists (Requirement 2.1)', () => {
    it('defines a worker service in docker-compose.yml', () => {
      expect(compose.services).toHaveProperty('worker')
    })
  })

  describe('build configuration (Requirement 2.2)', () => {
    it('build context is "." (monorepo root)', () => {
      expect(compose.services.worker.build?.context).toBe('.')
    })

    it('dockerfile is apps/worker/Dockerfile', () => {
      expect(compose.services.worker.build?.dockerfile).toBe('apps/worker/Dockerfile')
    })
  })

  describe('depends_on configuration (Requirement 2.3)', () => {
    it('depends_on includes postgres', () => {
      expect(compose.services.worker.depends_on).toHaveProperty('postgres')
    })

    it('postgres dependency has condition: service_healthy', () => {
      expect(compose.services.worker.depends_on?.postgres?.condition).toBe('service_healthy')
    })
  })

  describe('DATABASE_URL environment variable (Requirement 2.4)', () => {
    it('DATABASE_URL is set to the correct connection string', () => {
      expect(compose.services.worker.environment?.DATABASE_URL).toBe(
        'postgresql://arcpass:arcpass_local@postgres:5432/arcpass_dev?schema=public'
      )
    })
  })

  describe('environment variables with defaults (Requirement 2.5)', () => {
    it('POLL_INTERVAL_MS is 5000', () => {
      expect(compose.services.worker.environment?.POLL_INTERVAL_MS).toBe(5000)
    })

    it('BATCH_SIZE is 20', () => {
      expect(compose.services.worker.environment?.BATCH_SIZE).toBe(20)
    })

    it('MAX_RETRIES is 5', () => {
      expect(compose.services.worker.environment?.MAX_RETRIES).toBe(5)
    })

    it('RELAY_FAILURE_RATE is "0.0"', () => {
      expect(compose.services.worker.environment?.RELAY_FAILURE_RATE).toBe('0.0')
    })

    it('LOCK_TIMEOUT_MS is 30000', () => {
      expect(compose.services.worker.environment?.LOCK_TIMEOUT_MS).toBe(30000)
    })

    it('SHUTDOWN_TIMEOUT_MS is 10000', () => {
      expect(compose.services.worker.environment?.SHUTDOWN_TIMEOUT_MS).toBe(10000)
    })
  })

  describe('restart policy (Requirement 2.6)', () => {
    it('restart policy is unless-stopped', () => {
      expect(compose.services.worker.restart).toBe('unless-stopped')
    })
  })

  describe('postgres service unchanged (Requirement 2.7)', () => {
    it('postgres service still exists', () => {
      expect(compose.services).toHaveProperty('postgres')
    })

    it('postgres uses postgres:16-alpine image', () => {
      expect(compose.services.postgres.image).toBe('postgres:16-alpine')
    })

    it('postgres has healthcheck defined', () => {
      expect(compose.services.postgres.healthcheck).toBeDefined()
    })

    it('arcpass_pgdata volume is defined', () => {
      expect(compose.volumes).toHaveProperty('arcpass_pgdata')
    })
  })
})
