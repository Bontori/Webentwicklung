// Chat with the bot in your terminal, no WhatsApp account needed.
// Send a receipt with:  /photo path/to/receipt.jpg lunch 45000
import readline from 'node:readline';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bootstrap } from './app.js';

const { bot, config } = bootstrap();
const phone = config.allowedNumbers[0] || '10000000000';
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf' };

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'you> ' });
console.log(`Simulating WhatsApp messages from +${phone}. Type "help", or Ctrl+C to quit.`);
console.log('Start `npm start` in another terminal to open report links.\n');
rl.prompt();

for await (const line of rl) {
  let msg = { from: phone, text: line };
  const photo = line.match(/^\/photo\s+(\S+)\s*(.*)$/);
  if (photo) {
    const file = path.resolve(photo[1]);
    msg = {
      from: phone,
      text: photo[2],
      media: { mimeType: MIME[path.extname(file).toLowerCase()] || 'image/jpeg', download: async () => readFileSync(file) },
    };
  }
  try {
    const reply = await bot.handle(msg);
    if (reply) console.log(`\nbot> ${reply.replace(/\n/g, '\n     ')}\n`);
  } catch (err) {
    console.error('error:', err.message);
  }
  rl.prompt();
}
