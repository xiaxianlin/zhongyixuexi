/**
 * Unit tests for the red-line guard (S5.5 / 07-ai.md §12.1).
 *
 * Covers layer 2 (shouldBlock — keyword/regex pre-check) precision/recall and
 * layer 3 (sanitizeOutput — dosage-expression scrubbing). Layer 1 (System
 * Prompt) presence is covered in prompts.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { shouldBlock, sanitizeOutput, REFUSAL_TEXT, DOSAGE_SCRUB_TEXT } from './guard'

describe('shouldBlock (layer 2 — pre-call keyword scan)', () => {
  it('blocks diagnosis-seeking queries', () => {
    expect(shouldBlock('我最近失眠怎么办').blocked).toBe(true)
    expect(shouldBlock('我得了感冒能治好吗').blocked).toBe(true)
    expect(shouldBlock('老人经常咳嗽怎么调理').blocked).toBe(true)
  })

  it('blocks prescription/dosage-seeking queries', () => {
    expect(shouldBlock('该吃什么药').blocked).toBe(true)
    expect(shouldBlock('请给我开个方子').blocked).toBe(true)
    expect(shouldBlock('人参的用量是多少').blocked).toBe(true)
    expect(shouldBlock('这个药剂量多少合适').blocked).toBe(true)
  })

  it('blocks treatment-efficacy queries', () => {
    expect(shouldBlock('黄芪能治糖尿病吗').blocked).toBe(true)
    expect(shouldBlock('如何治疗高血压').blocked).toBe(true)
  })

  it('does NOT block genuine study questions', () => {
    // These are exactly the kind of question we want to answer.
    expect(shouldBlock('人参性味是什么').blocked).toBe(false)
    expect(shouldBlock('补五脏是什么意思').blocked).toBe(false)
    expectBlock(shouldBlock('黄芪补气固表的医理是什么'), false)
    expect(shouldBlock('').blocked).toBe(false)
    expect(shouldBlock('什么是归经').blocked).toBe(false)
  })

  it('returns the standard refusal text on block', () => {
    const r = shouldBlock('我头痛吃什么药')
    expect(r.blocked).toBe(true)
    expect(r.refusal).toBe(REFUSAL_TEXT)
  })
})

function expectBlock(r: { blocked: boolean }, expected: boolean): void {
  expect(r.blocked).toBe(expected)
}

describe('sanitizeOutput (layer 3 — post-call dosage scrub)', () => {
  it('scrubs digit + unit dosage expressions', () => {
    const out = sanitizeOutput('建议每日服用 3g 人参')
    expect(out.scrubbed).toBe(true)
    expect(out.text).toContain(DOSAGE_SCRUB_TEXT)
    expect(out.text).not.toContain('3g')
  })

  it('scrubs Chinese-unit dosages', () => {
    const out = sanitizeOutput('用 15 克黄芪煎服')
    expect(out.scrubbed).toBe(true)
    expect(out.text).not.toContain('15 克')
  })

  it('scrubs prescription phrasing', () => {
    const out = sanitizeOutput('建议口服水煎服，每日3次')
    expect(out.scrubbed).toBe(true)
  })

  it('leaves clean learning content untouched', () => {
    const clean = '人参味甘微寒，主补五脏，安精神。这是中医对人参药性的经典概括。'
    const out = sanitizeOutput(clean)
    expect(out.scrubbed).toBe(false)
    expect(out.text).toBe(clean)
  })

  it('handles empty input', () => {
    const out = sanitizeOutput('')
    expect(out.scrubbed).toBe(false)
    expect(out.text).toBe('')
  })

  it('does not scrub years / non-medical numbers', () => {
    const out = sanitizeOutput('《本草纲目》成书于 1578 年')
    expect(out.scrubbed).toBe(false)
  })
})
