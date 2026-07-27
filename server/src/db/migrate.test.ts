import { describe, it, expect } from 'vitest'
import { getPendingMigrations, type Migration } from './migrate'

const noopUp: Migration['up'] = async () => {}

describe('getPendingMigrations', () => {
  const migrations: Migration[] = [
    { version: 1, name: 'a', up: noopUp },
    { version: 2, name: 'b', up: noopUp },
    { version: 3, name: 'c', up: noopUp },
  ]

  it('returns all migrations when none applied', () => {
    expect(getPendingMigrations(new Set(), migrations).map((m) => m.version)).toEqual([1, 2, 3])
  })

  it('filters out already-applied versions', () => {
    expect(getPendingMigrations(new Set([1, 2]), migrations).map((m) => m.version)).toEqual([3])
  })

  it('returns empty when every version is applied', () => {
    expect(getPendingMigrations(new Set([1, 2, 3]), migrations)).toEqual([])
  })

  it('sorts by version ascending regardless of input order', () => {
    const unordered = [migrations[2], migrations[0], migrations[1]]
    expect(getPendingMigrations(new Set(), unordered).map((m) => m.version)).toEqual([1, 2, 3])
  })
})
