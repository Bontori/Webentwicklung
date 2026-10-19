import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openStore } from '../src/db.js';
import { createReceiptStore } from '../src/receipts.js';
import { createBot } from '../src/bot.js';

export const PHONE = '6281234567890';

export function setup(env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'expense-bot-'));
  const config = loadConfig({
    DATA_DIR: dir,
    TIMEZONE: 'Asia/Jakarta',
    DEFAULT_CURRENCY: 'IDR',
    ALLOWED_NUMBERS: PHONE,
    PUBLIC_BASE_URL: 'https://bot.example.com',
    ...env,
  });
  let clock = new Date('2026-10-19T03:00:00Z');
  const now = () => clock;
  const store = openStore(':memory:', { now });
  const receipts = createReceiptStore(config.receiptsDir);
  const bot = createBot({ store, receipts, config, now });
  const send = (text, extra = {}) => bot.handle({ from: PHONE, text, ...extra });
  const advance = (ms) => (clock = new Date(clock.getTime() + ms));
  return { config, store, receipts, bot, send, advance };
}

export const fakePhoto = (bytes = 'jpeg-bytes') => ({ mimeType: 'image/jpeg', download: async () => Buffer.from(bytes) });
