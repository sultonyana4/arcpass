import { describe, it, expect } from 'vitest'
import * as constants from './constants.js'
import * as helpers from './helpers.js'

describe('Validation Infrastructure', () => {
  it('test runner is configured and operational', () => {
    expect(true).toBe(true)
  })

  it('shared constants are importable and have expected types', () => {
    expect(constants.EXPECTED_CHAIN_ID).toBe(1942999)
    expect(constants.API_BASE_URL).toBeTypeOf('string')
    expect(constants.DB_CONNECTION_TIMEOUT_MS).toBeTypeOf('number')
    expect(constants.API_HEALTH_TIMEOUT_MS).toBeTypeOf('number')
    expect(constants.LIFECYCLE_TIMEOUT_MS).toBe(120_000)
    expect(constants.DEFAULT_POLL_INTERVAL_MS).toBe(2_000)
  })

  it('shared helpers are importable and have expected exports', () => {
    expect(helpers.isDatabaseReachable).toBeTypeOf('function')
    expect(helpers.isApiReachable).toBeTypeOf('function')
    expect(helpers.isRpcReachable).toBeTypeOf('function')
    expect(helpers.poll).toBeTypeOf('function')
    expect(helpers.checkEnvVars).toBeTypeOf('function')
    expect(helpers.getMissingEnvVars).toBeTypeOf('function')
    expect(helpers.sleep).toBeTypeOf('function')
    expect(helpers.jsonRpcCall).toBeTypeOf('function')
    expect(helpers.isFullStackReachable).toBeTypeOf('function')
  })

  it('checkEnvVars correctly identifies present and missing vars', () => {
    const result = helpers.checkEnvVars(['PATH', 'NONEXISTENT_VAR_XYZ_123'])
    expect(result['PATH'].present).toBe(true)
    expect(result['NONEXISTENT_VAR_XYZ_123'].present).toBe(false)
  })

  it('getMissingEnvVars returns missing variable names', () => {
    const missing = helpers.getMissingEnvVars(['PATH', 'NONEXISTENT_VAR_XYZ_123'])
    expect(missing).toContain('NONEXISTENT_VAR_XYZ_123')
    expect(missing).not.toContain('PATH')
  })
})
