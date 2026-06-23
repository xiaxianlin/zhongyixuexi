import { describe, it, expect } from 'vitest'
import { reanchorRange } from './excerpt-anchor'

const r = (oldText: string, newText: string, start: number, end: number, excerpt: string) =>
  reanchorRange({ oldText, newText, start, end, excerptText: excerpt })

describe('reanchorRange', () => {
  it('no-op when text unchanged (range preserved, not stale)', () => {
    const out = r('恬淡虚无，真气从之', '恬淡虚无，真气从之', 0, 4, '恬淡虚无')
    expect(out).toEqual({ start: 0, end: 4, stale: 0 })
  })

  it('exact single-occurrence match re-anchors to the new position', () => {
    // inserted a prefix '前言。' before the excerpt
    const out = r('恬淡虚无', '前言。恬淡虚无', 0, 4, '恬淡虚无')
    expect(out).toEqual({ start: 3, end: 7, stale: 0 })
  })

  it('pure deletion before the excerpt shifts the anchor left (exact match)', () => {
    const out = r('前言。恬淡虚无', '恬淡虚无', 3, 7, '恬淡虚无')
    expect(out).toEqual({ start: 0, end: 4, stale: 0 })
  })

  it('interior rewrite with stable bookends relocates via prefix/suffix bracket', () => {
    // excerpt was "真气从之"; interior char changed; bookends "真" and "从之" survive
    const out = r('恬淡虚无，真气从之', '恬淡虚无，真气顺之', 5, 9, '真气从之')
    expect(out.stale).toBe(0)
    expect(out.start).toBe(5)
    expect(out.end).toBeGreaterThan(out.start)
  })

  it('multiple edits leaving the excerpt intact elsewhere still re-anchor (exact)', () => {
    const out = r('甲乙恬淡虚无丙', '丙甲乙恬淡虚无', 2, 6, '恬淡虚无')
    expect(out).toEqual({ start: 3, end: 7, stale: 0 })
  })

  it('complete mismatch marks stale (keeps clamped offsets, flag 1)', () => {
    const out = r('恬淡虚无，真气从之', '精神内守，病安从来', 0, 4, '恬淡虚无')
    expect(out.stale).toBe(1)
    // offsets clamped to new text length
    expect(out.start).toBeGreaterThanOrEqual(0)
    expect(out.end).toBeLessThanOrEqual('精神内守，病安从来'.length)
  })

  it('single-character excerpt relocates to its first occurrence (best-effort)', () => {
    // '之' now appears three times; we can't disambiguate, so we anchor at the
    // first occurrence — acceptable for highlighting, not stale.
    const out = r('之', '之之之', 0, 1, '之')
    expect(out.stale).toBe(0)
    expect(out.start).toBe(0)
    expect(out.end).toBe(1)
  })

  it('empty excerpt is stale', () => {
    const out = r('abc', 'abc', 0, 0, '')
    expect(out.stale).toBe(1)
  })

  it('handles ASCII insertion at end', () => {
    const out = r('hello world', 'hello world!', 0, 5, 'hello')
    expect(out).toEqual({ start: 0, end: 5, stale: 0 })
  })
})
