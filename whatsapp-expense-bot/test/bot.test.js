import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PHONE, fakePhoto, setup } from './helpers.js';

test('records an expense and confirms it', async () => {
  const { send, store } = setup();
  const reply = await send('lunch with client 45000');
  assert.match(reply, /Recorded #1 2026-10-19 · Lunch with client · IDR 45,000 · Meals/);
  assert.equal(store.listExpenses(PHONE, { kind: 'all' }).length, 1);
});

test('ignores numbers that are not allowed and duplicate message ids', async () => {
  const { bot, send } = setup();
  assert.equal(await bot.handle({ from: '15550001111', text: 'lunch 45000' }), null);
  assert.ok(await send('taxi 10000', { id: 'wamid.1' }));
  assert.equal(await send('taxi 10000', { id: 'wamid.1' }), null);
});

test('stores receipts sent with a caption or right after the expense', async () => {
  const { send, store, receipts, advance } = setup();
  const reply = await send('dinner 320k', { media: fakePhoto('photo-1') });
  assert.match(reply, /📎/);
  const first = store.getExpense(PHONE, 1);
  assert.equal(readFileSync(receipts.resolve(first.receipt), 'utf8'), 'photo-1');

  await send('taxi 50000');
  assert.match(await send('', { media: fakePhoto() }), /Receipt attached to #2/);

  advance(60 * 60_000);
  await send('parking 5000');
  advance(31 * 60_000);
  assert.match(await send('', { media: fakePhoto() }), /which expense/);
});

test('rejects unsupported media types', async () => {
  const { send } = setup();
  const reply = await send('voice', { media: { mimeType: 'audio/ogg', download: async () => Buffer.alloc(0) } });
  assert.match(reply, /photo \(JPG\/PNG\) or PDF/);
});

test('still records the expense when the receipt download fails', async () => {
  const { send, store } = setup();
  const media = { mimeType: 'image/jpeg', download: async () => { throw new Error('boom'); } };
  const original = console.error;
  console.error = () => {};
  try {
    assert.match(await send('hotel 900000', { media }), /could not be downloaded/);
  } finally {
    console.error = original;
  }
  assert.equal(store.getExpense(PHONE, 1).receipt, null);
});

test('undo and delete remove expenses and their receipts', async () => {
  const { send, store, receipts } = setup();
  await send('taxi 50000', { media: fakePhoto() });
  const file = store.getExpense(PHONE, 1).receipt;
  await send('coffee 30000');
  assert.match(await send('undo'), /Deleted #2/);
  assert.match(await send('delete 1'), /Deleted #1/);
  assert.equal(receipts.resolve(file), null);
  assert.match(await send('delete 99'), /not found/);
  assert.match(await send('undo'), /nothing to undo/);
});

test('list and total summarise per period and currency', async () => {
  const { send } = setup();
  await send('hotel 1.000.000 2026-09-20');
  await send('taxi 50000');
  await send('coffee $4.50');
  const list = await send('list this month');
  assert.match(list, /October 2026\* \(2\)/);
  assert.match(list, /Total: IDR 50,000 \+ USD 4\.50/);
  const total = await send('total all');
  assert.match(total, /• Lodging: IDR 1,000,000/);
  assert.match(total, /3 expense/);
  assert.match(await send('list 2025-01'), /No expenses/);
});

test('report links, claim, and unclaimed default period', async () => {
  const { send, store } = setup();
  await send('name Jane Doe');
  await send('taxi 50000', { media: fakePhoto() });
  await send('lunch 75000');
  const reply = await send('report');
  assert.match(reply, /Reimbursement report R-2026-0001/);
  assert.match(reply, /2 expense\(s\) · IDR 125,000/);
  assert.match(reply, /1 without a receipt/);
  assert.match(reply, /https:\/\/bot\.example\.com\/r\/[\w-]{20,}\n/);

  // expenses added after the report are not claimed with it
  await send('parking 5000');
  assert.match(await send('claim'), /Marked 2 expense/);
  assert.match(await send('claim'), /already marked/);
  const open = store.listExpenses(PHONE, { kind: 'open' });
  assert.deepEqual(open.map((e) => e.description), ['Parking']);
  assert.match(await send('report all'), /3 expense/);
});

test('helpful replies for unknown input', async () => {
  const { send } = setup();
  assert.match(await send('hi'), /Expense bot/);
  assert.match(await send('what is this'), /couldn't find an amount/);
  assert.match(await send('report blah'), /don't understand the period "blah"/);
  // a period command word followed by an expense is still logged as an expense
  assert.match(await send('report printing 20000'), /Recorded #1 .* Report printing/);
});
