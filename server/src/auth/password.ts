import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const KEY_LENGTH = 64

/** Stored as `<salt-hex>:<derived-key-hex>`; scrypt cost params are the library defaults. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer
  return `${salt}:${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':')
  if (!salt || !hashHex) return false
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer
  const storedKey = Buffer.from(hashHex, 'hex')
  if (derived.length !== storedKey.length) return false
  return timingSafeEqual(derived, storedKey)
}
