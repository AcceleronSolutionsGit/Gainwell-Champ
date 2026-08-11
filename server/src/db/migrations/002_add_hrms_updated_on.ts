import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('employees')) {
    if (!(await knex.schema.hasColumn('employees', 'hrms_updated_on'))) {
      await knex.schema.table('employees', (t) => {
        t.string('hrms_updated_on', 30)
      })
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('employees')) {
    if (await knex.schema.hasColumn('employees', 'hrms_updated_on')) {
      await knex.schema.table('employees', (t) => {
        t.dropColumn('hrms_updated_on')
      })
    }
  }
}
