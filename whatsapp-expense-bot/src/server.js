import http from 'node:http';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { extractMetaMessages, verifyMetaSignature } from './whatsapp/meta.js';
import { extractTwilioMessage, twiml, verifyTwilioSignature } from './whatsapp/twilio.js';
import { renderReportCsv, renderReportHtml } from './report.js';
import { CONTENT_TYPES } from './receipts.js';
import { reportNumber } from './bot.js';

const MAX_BODY = 1024 * 1024;

const REPORT_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
  'X-Content-Type-Options': 'nosniff',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

/**
 * deps: { config, store, receipts, bot, meta?: MetaClient, twilioDownload?: (url) => Buffer }
 */
export function createApp({ config, store, receipts, bot, meta, twilioDownload }) {
  async function handleMetaWebhook(req, res, url) {
    if (req.method === 'GET') {
      const ok =
        url.searchParams.get('hub.mode') === 'subscribe' &&
        config.meta.verifyToken &&
        url.searchParams.get('hub.verify_token') === config.meta.verifyToken;
      return ok ? send(res, 200, url.searchParams.get('hub.challenge') || '') : send(res, 403, 'Forbidden');
    }
    const raw = await readBody(req);
    if (!verifyMetaSignature(raw, req.headers['x-hub-signature-256'], config.meta.appSecret)) {
      return send(res, 401, 'Invalid signature');
    }
    // acknowledge immediately; Meta retries webhooks that are slow to answer
    send(res, 200, 'OK');

    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }
    for (const m of extractMetaMessages(payload)) {
      try {
        const reply = m.unsupported
          ? await bot.handle({ id: m.id, from: m.from, text: '' })
          : await bot.handle({
              id: m.id,
              from: m.from,
              text: m.text,
              media: m.mediaId ? { mimeType: m.mimeType, download: () => meta.downloadMedia(m.mediaId) } : null,
            });
        if (reply) await meta.sendText(m.from, reply);
      } catch (err) {
        console.error(`failed to handle Meta message ${m.id}:`, err);
      }
    }
  }

  async function handleTwilioWebhook(req, res) {
    const raw = await readBody(req);
    const params = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
    const signedUrl = `${config.publicBaseUrl}${req.url}`;
    if (!verifyTwilioSignature(signedUrl, params, req.headers['x-twilio-signature'], config.twilio.authToken)) {
      return send(res, 401, 'Invalid signature');
    }
    const m = extractTwilioMessage(params);
    let reply = null;
    try {
      reply = await bot.handle({
        id: m.id,
        from: m.from,
        text: m.text,
        media: m.mediaUrl ? { mimeType: m.mimeType, download: () => twilioDownload(m.mediaUrl) } : null,
      });
    } catch (err) {
      console.error(`failed to handle Twilio message ${m.id}:`, err);
      reply = 'Sorry, something went wrong while saving that. Please try again.';
    }
    send(res, 200, twiml(reply), { 'Content-Type': 'text/xml; charset=utf-8' });
  }

  function handleReport(req, res, token, rest) {
    const report = store.getReport(token);
    if (!report) {
      return send(res, 404, 'This report link is invalid or has expired. Send "report" on WhatsApp for a new one.', REPORT_HEADERS);
    }
    const expenses = store.expensesByIds(report.phone, report.expenseIds);
    const basePath = `/r/${token}`;

    if (!rest) {
      const html = renderReportHtml({ report, user: store.getUser(report.phone), expenses, config, basePath });
      return send(res, 200, html, {
        ...REPORT_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy':
          "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      });
    }

    if (rest === '/csv') {
      const csv = renderReportCsv({
        expenses,
        receiptUrl: (e) => `${config.publicBaseUrl}${basePath}/receipts/${e.id}`,
      });
      return send(res, 200, csv, {
        ...REPORT_HEADERS,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${reportNumber(report)}.csv"`,
      });
    }

    const receiptMatch = rest.match(/^\/receipts\/(\d+)$/);
    const expense = receiptMatch && expenses.find((e) => e.id === Number(receiptMatch[1]));
    const file = expense?.receipt && receipts.resolve(expense.receipt);
    if (!file) return send(res, 404, 'Not found', REPORT_HEADERS);
    const ext = path.extname(file).slice(1);
    res.writeHead(200, {
      ...REPORT_HEADERS,
      'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
      'Content-Disposition': `inline; filename="receipt-${expense.id}.${ext}"`,
    });
    createReadStream(file).pipe(res);
  }

  return async function app(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/health') return send(res, 200, 'ok');
      if (url.pathname === '/webhook/meta' && ['GET', 'POST'].includes(req.method)) {
        if (!meta) return send(res, 404, 'Meta WhatsApp is not configured');
        return await handleMetaWebhook(req, res, url);
      }
      if (url.pathname === '/webhook/twilio' && req.method === 'POST') {
        if (!twilioDownload) return send(res, 404, 'Twilio is not configured');
        return await handleTwilioWebhook(req, res);
      }
      const report = url.pathname.match(/^\/r\/([A-Za-z0-9_-]{20,})(\/.*)?$/);
      if (report && req.method === 'GET') return handleReport(req, res, report[1], report[2] || '');
      send(res, 404, 'Not found');
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, err.status || 500, err.status ? err.message : 'Internal error');
    }
  };
}

export function startServer(deps) {
  const server = http.createServer(createApp(deps));
  return new Promise((resolve) => server.listen(deps.config.port, () => resolve(server)));
}
