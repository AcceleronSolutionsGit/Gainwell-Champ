/**
 * Database bootstrap. Local development uses zero-config SQLite
 * (better-sqlite3). Production uses managed PostgreSQL — on AWS that is RDS
 * in ap-south-1 (Mumbai) for DPDP data residency. Switch with
 * DATABASE_CLIENT=pg + DATABASE_URL (see .env.example).
 */
import knexFactory, { Knex } from 'knex'
import path from 'path'
import fs from 'fs'
import { config } from '../config'

let db: Knex | null = null

function knexConfig(): Knex.Config {
  if (config.db.client === 'pg' || config.db.client === 'mysql2' || config.db.client === 'mysql') {
    // PRODUCTION / EXTERNAL DB (PostgreSQL or MySQL/phpMyAdmin)
    if (!config.db.databaseUrl) {
      throw new Error(`DATABASE_CLIENT=${config.db.client} requires DATABASE_URL`)
    }
    return {
      client: config.db.client,
      connection: config.db.databaseUrl,
      pool: { min: 0, max: 10 },
    }
  }
  fs.mkdirSync(path.dirname(config.db.sqliteFile), { recursive: true })
  return {
    client: 'better-sqlite3',
    connection: { filename: config.db.sqliteFile },
    useNullAsDefault: true,
  }
}

const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

/**
 * Migration identity must be EXTENSION-AGNOSTIC: dev (tsx) loads
 * `001_init.ts`, the production build loads compiled `001_init.js`. Knex's
 * default FsMigrations records the full filename in knex_migrations, so a
 * database created in one mode crashes the other at boot with "the migration
 * directory is corrupt". Recording the bare name ('001_init') lets one
 * SQLite file move freely between `npm run dev`, `npm start` and the Docker
 * image (deploy/docker-compose.yml mounts the same ./data folder).
 */
class ExtensionAgnosticMigrationSource implements Knex.MigrationSource<string> {
  async getMigrations(): Promise<string[]> {
    return fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts'))
      .map((f) => f.replace(/\.(ts|js)$/, ''))
      .sort()
  }

  getMigrationName(migration: string): string {
    return migration
  }

  getMigration(migration: string): Promise<Knex.Migration> {
    const base = path.join(MIGRATIONS_DIR, migration)
    const file = [`${base}.ts`, `${base}.js`].find((f) => fs.existsSync(f))
    if (!file) throw new Error(`Migration file not found for "${migration}" in ${MIGRATIONS_DIR}`)
    // .ts resolves under tsx (dev); .js in the compiled dist build.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return Promise.resolve(require(file) as Knex.Migration)
  }
}

/** Databases created before the extension-agnostic source recorded
 *  '001_init.ts' / '001_init.js' — strip the extension once so they load. */
async function normalizeRecordedMigrationNames(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('knex_migrations'))) return
  const rows = (await knex('knex_migrations').select('id', 'name')) as { id: number; name: string }[]
  for (const row of rows) {
    const stripped = row.name.replace(/\.(ts|js)$/, '')
    if (stripped !== row.name) {
      await knex('knex_migrations').where({ id: row.id }).update({ name: stripped })
    }
  }
}

/** Open the connection and run pending migrations. Called once at boot. */
export async function initDb(): Promise<Knex> {
  if (db) return db
  db = knexFactory(knexConfig())
  await normalizeRecordedMigrationNames(db)
  await db.migrate.latest({
    migrationSource: new ExtensionAgnosticMigrationSource(),
    tableName: 'knex_migrations',
  })
  return db
}

export function getDb(): Knex {
  if (!db) throw new Error('Database not initialised — call initDb() first')
  return db
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy()
    db = null
  }
}
