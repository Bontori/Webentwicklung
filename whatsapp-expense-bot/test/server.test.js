import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import { createApp } from '../src/server.js';
import { PHONE, fakePhoto, setup } from './helpers.js';

const servers = [];
after(() => servers.forEach((s) => s.close()));

async function start(env = {}) {
  const ctx = setup({
    META_APP_SECRET: 'meta-secret',
    META_VERIFY_TOKEN: 'verify-me',
    TWILIO_AUTH_TOKEN: 'twilio-token',
    ...env,
  });
  const sent = [];
  const meta = {
    sendText: async (to, body) => sent.push({ to, body }),
    downloadMedia: async () => Buffer.from('meta-photo'),
  };
  const server = http.createServer(
    createApp({ ...ctx, meta, twilioDownload: async () => Buffer.from('twilio-photo') }),
  );
  await new Promise((r) => server.listen(0, r));
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { ...ctx, sent, base };
}

const waitFor = async (fn) => {
  for (let i = 0; i < 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 10));
};

const metaPayload = (message) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: { messages: [{ from: PHONE, timestamp: '1', ...message }] } }] }],
});

const metaPost = (base, payload, secret = 'meta-secret') => {
  const body = JSON.stringify(payload);
  const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  return fetch(`${base}/webhook/meta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
    body,
  });
};

test('Meta webhook verification handshake', async () => {
  const { base } = await start();
  const ok = await fetch(`${base}/webhook/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42`);
  assert.equal(await ok.text(), '42');
  const bad = await fetch(`${base}/webhook/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`);
  assert.equal(bad.status, 403);
});

test('Meta webhook records expenses, downloads receipts and replies', async () => {
  const { base, sent, store, receipts } = await start();
  const res = await metaPost(base, metaPayload({ id: 'wamid.A', type: 'text', text: { body: 'taxi 85000' } }));
  assert.equal(res.status, 200);
  await waitFor(() => sent.length === 1);
  assert.equal(sent[0].to, PHONE);
  assert.match(sent[0].body, /Recorded #1/);

  await metaPost(base, metaPayload({ id: 'wamid.B', type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'lunch 45000' } }));
  await waitFor(() => sent.length === 2);
  assert.match(sent[1].body, /Lunch · IDR 45,000 .*📎/);
  const file = receipts.resolve(store.getExpense(PHONE, 2).receipt);
  assert.ok(file);
});

test('Meta webhook rejects bad signatures', async () => {
  const { base, sent } = await start();
  const res = await metaPost(base, metaPayload({ id: 'x', type: 'text', text: { body: 'taxi 1' } }), 'wrong');
  assert.equal(res.status, 401);
  assert.equal(sent.length, 0);
});

function twilioSign(url, params, token = 'twilio-token') {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', token).update(data).digest('base64');
}

test('Twilio webhook replies with TwiML and checks the signature', async () => {
  const { base, store, config } = await start();
  const params = {
    MessageSid: 'SM1',
    From: `whatsapp:+${PHONE}`,
    Body: 'hotel 1.200.000',
    NumMedia: '1',
    MediaUrl0: 'https://api.twilio.com/media/1',
    MediaContentType0: 'image/png',
  };
  const signature = twilioSign(`${config.publicBaseUrl}/webhook/twilio`, params);
  const res = await fetch(`${base}/webhook/twilio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature },
    body: new URLSearchParams(params),
  });
  const xml = await res.text();
  assert.match(xml, /<Response><Message>✅ Recorded #1 .*Hotel · IDR 1,200,000/s);
  assert.match(store.getExpense(PHONE, 1).receipt, /\.png$/);

  const forged = await fetch(`${base}/webhook/twilio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'forged' },
    body: new URLSearchParams({ ...params, MessageSid: 'SM2' }),
  });
  assert.equal(forged.status, 401);
});

test('report page, CSV and receipts are served by token', async () => {
  const { base, send } = await start({ COMPANY_NAME: 'Acme <Corp>' });
  await send('name Jane <b>Doe</b>');
  await send('taxi 50000', { media: fakePhoto('receipt-bytes') });
  await send('+SUM(1) lunch 1000');
  await send('coffee $4.50');
  const reply = await send('report');
  const token = reply.match(/\/r\/([\w-]+)/)[1];

  const page = await fetch(`${base}/r/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await page.text();
  assert.match(html, /Acme &lt;Corp&gt;/);
  assert.match(html, /Jane &lt;b&gt;Doe&lt;\/b&gt;/);
  assert.match(html, /IDR 51,000/);
  assert.match(html, /USD 4\.50/);
  assert.match(html, /no exchange rates were applied/);
  assert.match(html, /<img src="\/r\/[\w-]+\/receipts\/1"/);

  const csv = await (await fetch(`${base}/r/${token}/csv`)).text();
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'ID,Date,Description,Category,Amount,Currency,Status,Receipt');
  assert.match(lines[1], /^1,2026-10-19,Taxi,Transport,50000\.00,IDR,open,https:\/\/bot\.example\.com\/r\/[\w-]+\/receipts\/1$/);
  assert.match(lines[2], /^2,2026-10-19,'\+SUM\(1\) lunch,Meals,1000\.00,IDR,open,$/);

  const receipt = await fetch(`${base}/r/${token}/receipts/1`);
  assert.equal(receipt.headers.get('content-type'), 'image/jpeg');
  assert.equal(await receipt.text(), 'receipt-bytes');
  assert.equal((await fetch(`${base}/r/${token}/receipts/2`)).status, 404);
  assert.equal((await fetch(`${base}/r/${'x'.repeat(32)}`)).status, 404);
});

test('report links expire', async () => {
  const { base, send, advance } = await start({ REPORT_LINK_TTL_HOURS: '1' });
  await send('taxi 50000');
  const token = (await send('report')).match(/\/r\/([\w-]+)/)[1];
  assert.equal((await fetch(`${base}/r/${token}`)).status, 200);
  advance(2 * 3600_000);
  assert.equal((await fetch(`${base}/r/${token}`)).status, 404);
});
