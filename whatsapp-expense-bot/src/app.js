import { existsSync } from 'node:fs';
import { loadConfig } from './config.js';
import { openStore } from './db.js';
import { createReceiptStore } from './receipts.js';
import { createBot } from './bot.js';

/** Loads .env and wires up the pieces shared by the server and the simulator. */
export function bootstrap() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = loadConfig();
  const store = openStore(config.dbFile);
  const receipts = createReceiptStore(config.receiptsDir);
  const bot = createBot({ store, receipts, config });
  return { config, store, receipts, bot };
}
