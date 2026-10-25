import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('user_credentials'))) {
    await knex.schema.createTable('user_credentials', (t) => {
      t.string('email', 160).primary()
      t.string('password_hash', 200).notNullable()
      t.string('salt', 100).notNullable()
      t.integer('must_change_password').notNullable().defaultTo(1)
      t.string('created_at', 30).notNullable()
      t.string('updated_at', 30).notNullable()
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_credentials')
}
