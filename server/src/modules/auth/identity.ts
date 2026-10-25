import { getDb } from '../../db/knex'
import { Employee, SessionUser } from '../../types'

export function nameFromLocalPart(email: string): string {
  const local = email.split('@')[0] ?? email
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export async function resolveIdentity(emailRaw: string): Promise<SessionUser | null> {
  const email = emailRaw.trim().toLowerCase()
  const db = getDb()
  const adminRow = (await db('admin_users').whereRaw('lower(email) = ?', [email]).first()) as
    | { email: string; role: 'admin' | 'committee' }
    | undefined
  const employee = (await db('employees')
    .whereRaw('lower(email) = ?', [email])
    .where({ active: 1 })
    .first()) as Employee | undefined
  if (!adminRow && !employee) return null
  return {
    email,
    employeeId: employee?.id ?? null,
    name: employee?.name ?? nameFromLocalPart(email),
    role: adminRow?.role ?? 'employee',
  }
}
