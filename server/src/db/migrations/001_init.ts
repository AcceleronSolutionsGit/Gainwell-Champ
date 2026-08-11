import { Knex } from 'knex'

/**
 * Initial schema — FRD §6 core data model plus conversation state, OTP codes,
 * console roles, runtime settings and the audit log (FRD §7 auditability).
 *
 * Portability conventions (SQLite locally, PostgreSQL in production):
 *   - timestamps are ISO-8601 UTC strings in VARCHAR(30) columns — identical
 *     behaviour on both engines, lexicographic order == chronological order;
 *   - boolean-ish flags are INTEGER 0/1 columns — write 1/0, read truthily.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('employees'))) {
    await knex.schema.createTable('employees', (t) => {
      t.increments('id').primary()
      t.string('employee_code', 20).notNullable().unique()
      t.string('name', 120).notNullable()
      t.string('function', 60).notNullable()
      t.string('sub_team', 80)
      t.string('shift', 20).notNullable().defaultTo('General')
      t.string('site', 80).notNullable()
      t.string('mobile', 20).notNullable().unique()
      t.string('email', 160)
      t.string('employment_type', 20).notNullable().defaultTo('permanent')
      t.string('level_grade', 10).notNullable().defaultTo('L2')
      t.integer('manager_id').unsigned().references('id').inTable('employees')
      t.integer('active').notNullable().defaultTo(1)
      t.string('language', 5).notNullable().defaultTo('en')
      t.integer('consent_recorded').notNullable().defaultTo(0)
      t.string('created_at', 30).notNullable()
      t.string('updated_at', 30).notNullable()
      t.index(['email'])
      t.index(['active'])
    })
  }

  if (!(await knex.schema.hasTable('behaviours'))) {
    await knex.schema.createTable('behaviours', (t) => {
      t.increments('id').primary()
      t.string('name', 60).notNullable().unique()
      t.string('description', 200).notNullable().defaultTo('')
      t.string('colour', 9).notNullable().defaultTo('#2FA88C')
      t.integer('active').notNullable().defaultTo(1)
      t.integer('sort_order').notNullable().defaultTo(0)
    })
  }

  if (!(await knex.schema.hasTable('recognitions'))) {
    await knex.schema.createTable('recognitions', (t) => {
      t.increments('id').primary()
      t.integer('giver_id').unsigned().notNullable().references('id').inTable('employees')
      t.integer('recipient_id').unsigned().notNullable().references('id').inTable('employees')
      t.integer('behaviour_id').unsigned().notNullable().references('id').inTable('behaviours')
      t.text('reason_text').notNullable()
      t.string('channel', 20).notNullable().defaultTo('whatsapp')
      t.string('status', 10).notNullable().defaultTo('active') // active | flagged | removed
      t.string('removal_reason', 300)
      t.string('removed_by', 160)
      t.string('removed_at', 30)
      t.string('created_at', 30).notNullable()
      t.index(['created_at'])
      t.index(['giver_id', 'recipient_id', 'created_at']) // BR-2 cap lookups
      t.index(['recipient_id'])
      t.index(['status', 'created_at'])
    })
  }

  if (!(await knex.schema.hasTable('flags'))) {
    await knex.schema.createTable('flags', (t) => {
      t.increments('id').primary()
      t.integer('recognition_id').unsigned().notNullable().references('id').inTable('recognitions')
      t.string('type', 10).notNullable() // loop | burst
      t.text('details') // JSON: pattern specifics for the admin queue
      t.string('status', 10).notNullable().defaultTo('open') // open | resolved
      t.string('resolved_by', 160)
      t.string('resolved_at', 30)
      t.string('resolution', 30) // dismissed | removed
      t.string('created_at', 30).notNullable()
      t.index(['status'])
    })
  }

  if (!(await knex.schema.hasTable('conversation_state'))) {
    await knex.schema.createTable('conversation_state', (t) => {
      t.string('mobile', 20).primary()
      t.text('state').notNullable() // JSON state machine snapshot
      t.string('updated_at', 30).notNullable()
    })
  }

  if (!(await knex.schema.hasTable('otp_codes'))) {
    await knex.schema.createTable('otp_codes', (t) => {
      t.increments('id').primary()
      t.string('email', 160).notNullable()
      t.string('code_hash', 80).notNullable()
      t.string('expires_at', 30).notNullable()
      t.integer('attempts').notNullable().defaultTo(0)
      t.string('consumed_at', 30)
      t.string('created_at', 30).notNullable()
      t.index(['email'])
    })
  }

  if (!(await knex.schema.hasTable('admin_users'))) {
    await knex.schema.createTable('admin_users', (t) => {
      t.string('email', 160).primary()
      t.string('role', 20).notNullable() // admin | committee
      t.string('created_at', 30).notNullable()
    })
  }

  if (!(await knex.schema.hasTable('settings'))) {
    await knex.schema.createTable('settings', (t) => {
      t.string('key', 60).primary()
      t.text('value').notNullable() // JSON-encoded
    })
  }

  if (!(await knex.schema.hasTable('audit_log'))) {
    await knex.schema.createTable('audit_log', (t) => {
      t.increments('id').primary()
      t.string('actor', 160).notNullable() // email or 'system'
      t.string('action', 60).notNullable()
      t.string('entity_type', 40)
      t.string('entity_id', 40)
      t.text('details') // JSON
      t.string('created_at', 30).notNullable()
      t.index(['created_at'])
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_log')
  await knex.schema.dropTableIfExists('settings')
  await knex.schema.dropTableIfExists('admin_users')
  await knex.schema.dropTableIfExists('otp_codes')
  await knex.schema.dropTableIfExists('conversation_state')
  await knex.schema.dropTableIfExists('flags')
  await knex.schema.dropTableIfExists('recognitions')
  await knex.schema.dropTableIfExists('behaviours')
  await knex.schema.dropTableIfExists('employees')
}
