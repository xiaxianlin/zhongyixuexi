import { describe, it, expect } from 'vitest'
import { AppError, serializeError } from './error'

describe('AppError / serializeError', () => {
  it('serializes an AppError with code and details', () => {
    expect(serializeError(new AppError('PARSE', 'bad epub', { at: 3 }))).toEqual({
      code: 'PARSE',
      message: 'bad epub',
      details: { at: 3 },
    })
  })

  it('serializes a plain Error as UNKNOWN', () => {
    expect(serializeError(new Error('boom'))).toEqual({ code: 'UNKNOWN', message: 'boom' })
  })

  it('serializes a non-Error value', () => {
    expect(serializeError('wat')).toEqual({ code: 'UNKNOWN', message: 'wat' })
  })
})
