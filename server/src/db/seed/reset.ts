/** CLI entry: `npm run seed:reset` — wipe all data and reload the demo seed. */
import { initDb, closeDb } from '../knex'
import { resetAndSeed } from './demo'

async function main() {
  const db = await initDb()
  await resetAndSeed(db)
  await closeDb()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
