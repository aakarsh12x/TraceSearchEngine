import { sql } from '../src/db.js';

async function run() {
  const count  = await sql`SELECT count(*) as pages FROM pages`;
  const size   = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) as size, pg_database_size(current_database()) as bytes`;
  const mb     = (Number(size[0].bytes) / (1024 * 1024)).toFixed(1);
  const cap    = 350;
  const pct    = ((Number(mb) / cap) * 100).toFixed(1);

  console.log(`\n📊 Trace Search Engine — DB Status`);
  console.log(`   Pages indexed : ${Number(count[0].pages).toLocaleString()}`);
  console.log(`   DB size       : ${mb} MB / ${cap} MB  (${pct}% used)`);
  console.log(`   Neon size     : ${size[0].size}\n`);
  process.exit(0);
}

run();
