import { config } from 'dotenv';
import { initDb } from '../src/lib/db';

config();

async function main() {
  console.log('Initializing database...');
  try {
    await initDb();
    console.log('Initialization complete.');
  } catch (err) {
    console.error('Initialization failed:', err);
    process.exit(1);
  }
}

main();
