import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const monorepoRoot = path.resolve(__dirname, '..', '..', '..')
const workerRoot = path.resolve(__dirname, '..')

describe('.dockerignore Smoke Tests', () => {
  const dockerignorePath = path.join(monorepoRoot, '.dockerignore')
  const content = fs.readFileSync(dockerignorePath, 'utf-8')

  it('.dockerignore file exists at monorepo root', () => {
    expect(fs.existsSync(dockerignorePath)).toBe(true)
  })

  it('excludes node_modules', () => {
    expect(content).toContain('node_modules')
  })

  it('excludes .git', () => {
    expect(content).toContain('.git')
  })

  it('excludes dist', () => {
    expect(content).toContain('dist')
  })
})

describe('Entrypoint Script Smoke Tests', () => {
  const entrypointPath = path.join(workerRoot, 'entrypoint.sh')
  const content = fs.readFileSync(entrypointPath, 'utf-8')

  it('entrypoint.sh exists at apps/worker/', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true)
  })

  it('has proper shebang line', () => {
    const firstLine = content.split('\n')[0]
    expect(firstLine).toMatch(/^#!\/bin\/(sh|bash)/)
  })

  it('contains prisma migrate deploy command', () => {
    expect(content).toContain('prisma migrate deploy')
  })

  it('contains node command to start the worker', () => {
    expect(content).toContain('node')
  })

  it('runs prisma migrate deploy before the node command', () => {
    const migrateIndex = content.indexOf('prisma migrate deploy')
    const nodeIndex = content.indexOf('node')
    expect(migrateIndex).toBeGreaterThan(-1)
    expect(nodeIndex).toBeGreaterThan(-1)
    expect(migrateIndex).toBeLessThan(nodeIndex)
  })
})
