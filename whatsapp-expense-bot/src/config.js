import path from 'node:path';

const list = (value) =>
  (value || '')
    .split(',')
    .map((s) => normalizePhone(s))
    .filter(Boolean);

export function normalizePhone(value) {
  return String(value || '').replace(/^whatsapp:/i, '').replace(/\D/g, '');
}

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR || './data');
  return {
    port: Number(env.PORT || 3000),
    publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, ''),
    dataDir,
    dbFile: path.join(dataDir, 'expenses.db'),
    receiptsDir: path.join(dataDir, 'receipts'),
    timezone: env.TIMEZONE || 'UTC',
    defaultCurrency: (env.DEFAULT_CURRENCY || 'USD').toUpperCase(),
    locale: env.LOCALE || 'en-US',
    allowedNumbers: list(env.ALLOWED_NUMBERS),
    reportTtlHours: Number(env.REPORT_LINK_TTL_HOURS || 72),
    companyName: env.COMPANY_NAME || '',
    meta: {
      accessToken: env.META_ACCESS_TOKEN || '',
      phoneNumberId: env.META_PHONE_NUMBER_ID || '',
      appSecret: env.META_APP_SECRET || '',
      verifyToken: env.META_VERIFY_TOKEN || '',
      graphVersion: env.META_GRAPH_VERSION || 'v23.0',
    },
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID || '',
      authToken: env.TWILIO_AUTH_TOKEN || '',
    },
  };
}
