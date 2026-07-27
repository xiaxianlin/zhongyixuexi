/** Shared domain error types — routes map these to 404/400, anything else is a 500. */
export class NotFoundError extends Error {}
export class ValidationError extends Error {}
