import { sql } from '../src/db.js';

async function run() {
  const ts = await sql`SELECT COUNT(*) as c FROM pages WHERE url LIKE '%typescriptlang%'`;
  const total = await sql`SELECT COUNT(*) as c FROM pages`;
  const sample = await sql`SELECT url, title FROM pages WHERE url LIKE '%typescriptlang%' LIMIT 5`;

  console.log(`\nTypeScript docs in DB : ${ts[0].c}`);
  console.log(`Total pages in DB     : ${total[0].c}`);
  console.log(`\nSample TS pages:`);
  sample.forEach((r: any) => console.log(`  ${r.url} — ${r.title}`));
  process.exit(0);
}
run();
