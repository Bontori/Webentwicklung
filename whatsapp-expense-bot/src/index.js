import { bootstrap } from './app.js';
import { startServer } from './server.js';
import { createMetaClient } from './whatsapp/meta.js';
import { createTwilioMediaDownloader } from './whatsapp/twilio.js';

const deps = bootstrap();
const { config } = deps;

const metaReady = Boolean(config.meta.accessToken && config.meta.phoneNumberId && config.meta.appSecret);
const twilioReady = Boolean(config.twilio.accountSid && config.twilio.authToken);

const server = await startServer({
  ...deps,
  meta: metaReady ? createMetaClient(config.meta) : null,
  twilioDownload: twilioReady ? createTwilioMediaDownloader(config.twilio) : null,
});

console.log(`Expense bot listening on :${server.address().port}`);
console.log(`  Meta webhook:   ${metaReady ? `${config.publicBaseUrl}/webhook/meta` : 'disabled (set META_* in .env)'}`);
console.log(`  Twilio webhook: ${twilioReady ? `${config.publicBaseUrl}/webhook/twilio` : 'disabled (set TWILIO_* in .env)'}`);
if (!config.allowedNumbers.length) {
  console.warn('  WARNING: ALLOWED_NUMBERS is empty, so anyone who messages the bot can log expenses.');
}
if (!metaReady && !twilioReady) {
  console.warn('  No WhatsApp provider configured. Try `npm run simulate` to use the bot locally.');
}
