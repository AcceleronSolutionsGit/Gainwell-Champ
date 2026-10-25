import crypto from 'crypto'
import { getDb } from '../../db/knex'
import { nowIso } from '../../db/time'

export interface UserCredentials {
  email: string
  password_hash: string
  salt: string
  must_change_password: number
  created_at: string
  updated_at: string
}

export const DEFAULT_PASSWORD = '123456'

export function hashPassword(
  password: string,
  salt = crypto.randomBytes(16).toString('hex'),
): { hash: string; salt: string } {
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex')
  return { hash, salt }
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const computed = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex')
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'))
  } catch {
    return false
  }
}

export async function getUserCredentials(emailRaw: string): Promise<UserCredentials | null> {
  const email = emailRaw.trim().toLowerCase()
  const db = getDb()
  const row = (await db('user_credentials').whereRaw('lower(email) = ?', [email]).first()) as
    | UserCredentials
    | undefined
  return row ?? null
}

export async function ensureUserCredentials(emailRaw: string): Promise<UserCredentials> {
  const email = emailRaw.trim().toLowerCase()
  const existing = await getUserCredentials(email)
  if (existing) return existing

  const { hash, salt } = hashPassword(DEFAULT_PASSWORD)
  const now = nowIso()
  const row: UserCredentials = {
    email,
    password_hash: hash,
    salt,
    must_change_password: 1,
    created_at: now,
    updated_at: now,
  }

  const db = getDb()
  await db('user_credentials').insert(row)
  return row
}

export async function changeUserPassword(emailRaw: string, newPassword: string): Promise<void> {
  const email = emailRaw.trim().toLowerCase()
  const { hash, salt } = hashPassword(newPassword)
  const db = getDb()
  const now = nowIso()

  const existing = await getUserCredentials(email)
  if (!existing) {
    await db('user_credentials').insert({
      email,
      password_hash: hash,
      salt,
      must_change_password: 0,
      created_at: now,
      updated_at: now,
    })
  } else {
    await db('user_credentials')
      .whereRaw('lower(email) = ?', [email])
      .update({
        password_hash: hash,
        salt,
        must_change_password: 0,
        updated_at: now,
      })
  }
}
