import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Smoke tests for apps/worker/Dockerfile structure.
 * These tests parse the Dockerfile as text and assert on its contents.
 * No Docker engine required.
 *
 * Validates: Requirements 1.1, 1.2, 1.4, 1.6, 1.8, 7.3
 */
describe('Dockerfile smoke tests', () => {
  let dockerfile: string

  beforeAll(() => {
    const dockerfilePath = resolve(__dirname, '..', 'Dockerfile')
    dockerfile = readFileSync(dockerfilePath, 'utf-8')
  })

  describe('multi-stage build structure (Requirement 1.1)', () => {
    it('has at least 3 FROM stages', () => {
      const fromStatements = dockerfile.match(/^FROM\s+/gm)
      expect(fromStatements).not.toBeNull()
      expect(fromStatements!.length).toBeGreaterThanOrEqual(3)
    })

    it('defines named stages: deps, build, runtime', () => {
      expect(dockerfile).toMatch(/FROM\s+\S+\s+AS\s+deps/i)
      expect(dockerfile).toMatch(/FROM\s+\S+\s+AS\s+build/i)
      expect(dockerfile).toMatch(/FROM\s+\S+\s+AS\s+runtime/i)
    })
  })

  describe('base image (Requirement 1.1)', () => {
    it('uses node:22-alpine as base image for deps stage', () => {
      expect(dockerfile).toMatch(/FROM\s+node:22-alpine\s+AS\s+deps/i)
    })

    it('uses node:22-alpine as base image for runtime stage', () => {
      expect(dockerfile).toMatch(/FROM\s+node:22-alpine\s+AS\s+runtime/i)
    })
  })

  describe('corepack and pnpm setup (Requirement 1.2)', () => {
    it('enables corepack', () => {
      expect(dockerfile).toMatch(/corepack\s+enable/)
    })

    it('prepares pnpm via corepack', () => {
      expect(dockerfile).toMatch(/corepack\s+prepare\s+pnpm/)
    })
  })

  describe('dependency installation (Requirement 1.4)', () => {
    it('runs pnpm install --frozen-lockfile', () => {
      expect(dockerfile).toMatch(/pnpm\s+install\s+--frozen-lockfile/)
    })
  })

  describe('production deploy (Requirement 1.6)', () => {
    it('runs pnpm deploy --prod', () => {
      expect(dockerfile).toMatch(/pnpm\s+deploy\s+.*--prod/)
    })
  })

  describe('production environment (Requirement 1.8)', () => {
    it('sets NODE_ENV=production', () => {
      expect(dockerfile).toMatch(/ENV\s+NODE_ENV=production/)
    })
  })

  describe('openssl installation (Requirement 7.3)', () => {
    it('installs openssl for Prisma engine compatibility', () => {
      expect(dockerfile).toMatch(/apk\s+add\s+.*openssl/)
    })
  })
})
