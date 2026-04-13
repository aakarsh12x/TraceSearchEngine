import { sql } from '../src/db.js';

async function run() {
  const result = await sql`SELECT count(*) FROM pages`;
  console.log(`CURRENT DB ROW COUNT: ${result[0].count}`);
  process.exit(0);
}

run();
