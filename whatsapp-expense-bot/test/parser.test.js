import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNumber, parseCommand, parseExpense, parsePeriod } from '../src/parser.js';

const ctx = { today: '2026-10-19', defaultCurrency: 'IDR' };
const parse = (text) => parseExpense(text, ctx);

test('normalizeNumber handles thousands and decimal separators', () => {
  assert.equal(normalizeNumber('45000'), 45000);
  assert.equal(normalizeNumber('1.250.000'), 1250000);
  assert.equal(normalizeNumber('1,250,000.50'), 1250000.5);
  assert.equal(normalizeNumber('1.250.000,50'), 1250000.5);
  assert.equal(normalizeNumber('12.50'), 12.5);
  assert.equal(normalizeNumber('12,5'), 12.5);
  assert.equal(normalizeNumber('12.500'), 12500);
  assert.equal(normalizeNumber('0.500'), 0.5);
});

test('parses plain expenses with the default currency', () => {
  assert.deepEqual(parse('lunch with client 45000'), {
    amountCents: 4_500_000,
    currency: 'IDR',
    description: 'Lunch with client',
    category: 'Meals',
    spentOn: '2026-10-19',
  });
});

test('recognises currency codes, symbols and suffixes', () => {
  assert.equal(parse('taxi $12.50').currency, 'USD');
  assert.equal(parse('taxi $12.50').amountCents, 1250);
  assert.equal(parse('printing 12,50 EUR').currency, 'EUR');
  assert.equal(parse('Grab Rp 85.000').amountCents, 8_500_000);
  assert.equal(parse('dinner 320k').amountCents, 32_000_000);
  assert.equal(parse('snacks 50rb').amountCents, 5_000_000);
  assert.equal(parse('laptop repair 1.5jt').amountCents, 150_000_000);
  // lower-case three letter words are never currencies
  assert.equal(parse('dinner for 200000').currency, 'IDR');
});

test('picks the amount with a currency, otherwise the largest number', () => {
  assert.equal(parse('Flight GA 402 1500000').amountCents, 150_000_000);
  assert.equal(parse('room 1204 85 USD').amountCents, 8500);
  assert.equal(parse('room 1204 85 USD').description, 'Room 1204');
});

test('hashtags set the category, keywords guess it', () => {
  assert.equal(parse('client gift 300000 #entertainment').category, 'Entertainment');
  assert.equal(parse('stuff 100 #office_supplies').category, 'Office supplies');
  assert.equal(parse('hotel 1000000').category, 'Lodging');
  assert.equal(parse('mystery 1000').category, 'Other');
});

test('parses dates', () => {
  assert.equal(parse('hotel 500000 yesterday').spentOn, '2026-10-18');
  assert.equal(parse('taxi 50000 15/10').spentOn, '2026-10-15');
  assert.equal(parse('taxi 50000 2026-09-30').spentOn, '2026-09-30');
  assert.equal(parse('taxi 50000 28/12').spentOn, '2025-12-28');
  assert.equal(parse('taxi 50000 15/10').description, 'Taxi');
});

test('times are kept in the description and not used as amounts', () => {
  const e = parse('meeting 12:30 snacks 50rb');
  assert.equal(e.amountCents, 5_000_000);
  assert.equal(e.description, 'Meeting 12:30 snacks');
});

test('returns null without an amount', () => {
  assert.equal(parse('hello there'), null);
  assert.equal(parse('#meals'), null);
});

test('parsePeriod', () => {
  assert.deepEqual(parsePeriod('', ctx), { kind: 'open', label: 'Unclaimed expenses' });
  assert.equal(parsePeriod('all', ctx).kind, 'all');
  assert.deepEqual(parsePeriod('last month', ctx), {
    kind: 'range', from: '2026-09-01', to: '2026-09-30', label: 'September 2026',
  });
  assert.equal(parsePeriod('this month', ctx).to, '2026-10-31');
  assert.equal(parsePeriod('feb 2024', ctx).to, '2024-02-29');
  assert.equal(parsePeriod('december', ctx).from, '2025-12-01');
  assert.equal(parsePeriod('2026-10-01 to 2026-10-15', ctx).to, '2026-10-15');
  assert.equal(parsePeriod('lunch', ctx), null);
  assert.equal(parsePeriod('last month', { today: '2026-01-05' }).from, '2025-12-01');
});

test('parseCommand', () => {
  assert.equal(parseCommand('help', ctx).type, 'help');
  assert.equal(parseCommand('/report last month', ctx).period.label, 'September 2026');
  assert.deepEqual(parseCommand('delete #12', ctx), { type: 'delete', id: 12 });
  assert.deepEqual(parseCommand('name Jane Doe', ctx), { type: 'name', name: 'Jane Doe' });
  assert.equal(parseCommand('report printing 20000', ctx).type, 'badPeriod');
  assert.equal(parseCommand('lunch 45000', ctx), null);
});
