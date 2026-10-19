import { addDays, isValidDate, isoDate, monthLabel, monthRange, MONTH_NAMES } from './dates.js';

const ISO_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
const DOLLAR_CURRENCIES = new Set(['USD', 'SGD', 'AUD', 'CAD', 'NZD', 'HKD']);

const SYMBOLS = {
  'US$': 'USD', 'S$': 'SGD', 'A$': 'AUD', 'HK$': 'HKD',
  RP: 'IDR', 'RP.': 'IDR', RM: 'MYR',
  '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₱': 'PHP', '฿': 'THB', '₩': 'KRW',
};

const SYM = String.raw`US\$|S\$|A\$|HK\$|[Rr][Pp]\.?|RM|[$€£¥₹₱฿₩]`;
const AMOUNT_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}#\-/_.,])(?:(?<pre>${SYM}|[A-Z]{3})\s?)?` +
    String.raw`(?<num>\d+(?:[.,]\d+)*)(?<suf>[kK]|rb|ribu|jt|juta|[mM])?` +
    String.raw`(?:\s?(?<post>[A-Z]{3}|${SYM}))?(?![\p{L}\p{N}])`,
  'dgu',
);

// times like 12:30 are masked with a private-use character so they never parse as amounts
const TIME_RE = /\b\d{1,2}:\d{2}(\s?[ap]m)?\b/gi;
const MASK = '\uE000';

const MULTIPLIERS = { k: 1e3, rb: 1e3, ribu: 1e3, jt: 1e6, juta: 1e6, m: 1e6 };

const CATEGORY_KEYWORDS = [
  ['Meals', ['lunch', 'dinner', 'breakfast', 'brunch', 'coffee', 'meal', 'food', 'snack', 'snacks', 'restaurant', 'cafe', 'drinks', 'makan']],
  ['Lodging', ['hotel', 'airbnb', 'accommodation', 'lodging', 'hostel', 'inn']],
  ['Travel', ['flight', 'airfare', 'airline', 'plane', 'baggage', 'visa']],
  ['Transport', ['taxi', 'cab', 'grab', 'gojek', 'uber', 'lyft', 'train', 'bus', 'mrt', 'parking', 'toll', 'fuel', 'gas', 'petrol', 'bensin', 'transport', 'ojek']],
  ['Office', ['printing', 'print', 'stationery', 'paper', 'office', 'supplies', 'ink']],
  ['Communication', ['phone', 'internet', 'pulsa', 'wifi', 'sim']],
];

/** Converts "1.250.000", "1,250.50", "12,5" etc. to a number. */
export function normalizeNumber(str) {
  const dots = (str.match(/\./g) || []).length;
  const commas = (str.match(/,/g) || []).length;
  if (dots && commas) {
    const decimal = str.lastIndexOf('.') > str.lastIndexOf(',') ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    return Number(str.split(thousands).join('').replace(decimal, '.'));
  }
  if (!dots && !commas) return Number(str);
  const sep = dots ? '.' : ',';
  const parts = str.split(sep);
  // "1.250.000" or "12.500" -> thousands separator; "12.5" / "0.500" -> decimal
  const isThousands = parts.length > 2 || (parts[1].length === 3 && parts[0] !== '0');
  return Number(isThousands ? parts.join('') : parts.join('.'));
}

function resolveCurrency(token, defaultCurrency) {
  if (!token) return null;
  const upper = token.toUpperCase();
  if (upper === '$') return DOLLAR_CURRENCIES.has(defaultCurrency) ? defaultCurrency : 'USD';
  if (SYMBOLS[upper]) return SYMBOLS[upper];
  // three-letter codes must be written in upper case to avoid matching words like "for"
  if (/^[A-Z]{3}$/.test(token) && ISO_CURRENCIES.has(token)) return token;
  return null;
}

function findAmounts(text, defaultCurrency) {
  const found = [];
  for (const match of text.matchAll(AMOUNT_RE)) {
    const { pre, num, suf, post } = match.groups;
    const idx = match.indices.groups;
    const preCurrency = resolveCurrency(pre, defaultCurrency);
    const postCurrency = resolveCurrency(post, defaultCurrency);
    let value = normalizeNumber(num);
    if (suf) value *= MULTIPLIERS[suf.toLowerCase()];
    if (!Number.isFinite(value) || value <= 0) continue;
    const start = preCurrency ? idx.pre[0] : idx.num[0];
    const end = postCurrency ? idx.post[1] : suf ? idx.suf[1] : idx.num[1];
    found.push({ value, currency: preCurrency || postCurrency, start, end });
  }
  return found;
}

function extractDate(text, today) {
  const [ty] = today.split('-').map(Number);
  const rules = [
    [/\b(today|hari ini)\b/i, () => today],
    [/\b(yesterday|kemarin)\b/i, () => addDays(today, -1)],
    [/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      return isValidDate(y, mo, d) ? isoDate(y, mo, d) : null;
    }],
    [/(?<![\d.,])(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?![\d/])/, (m) => {
      const [d, mo] = [Number(m[1]), Number(m[2])];
      let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : ty;
      if (!isValidDate(y, mo, d)) return null;
      // "28/12" sent in January means last December
      if (!m[3] && isoDate(y, mo, d) > today) y -= 1;
      return isValidDate(y, mo, d) ? isoDate(y, mo, d) : null;
    }],
  ];
  for (const [re, toDate] of rules) {
    const m = text.match(re);
    if (!m) continue;
    const date = toDate(m);
    if (date) return { date, text: text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length) };
  }
  return { date: today, text };
}

function titleCase(tag) {
  const words = tag.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

export function guessCategory(text) {
  const lower = text.toLowerCase();
  for (const [category, words] of CATEGORY_KEYWORDS) {
    if (words.some((w) => new RegExp(`\\b${w}\\b`).test(lower))) return category;
  }
  return 'Other';
}

/**
 * Parses free text such as "lunch with client 45k #meals yesterday" into an
 * expense. Returns null when no amount can be found.
 */
export function parseExpense(input, { today, defaultCurrency = 'USD' }) {
  let text = ` ${input} `;

  let category = null;
  text = text.replace(/#([\p{L}\p{N}_-]+)/gu, (_, tag) => {
    category ??= titleCase(tag);
    return ' ';
  });

  text = text.replace(TIME_RE, (t) => t.replace(/\d/g, MASK));

  const dated = extractDate(text, today);
  text = dated.text;

  const amounts = findAmounts(text, defaultCurrency);
  if (!amounts.length) return null;
  // prefer an amount with an explicit currency, otherwise the largest number
  const chosen =
    amounts.find((a) => a.currency) || amounts.reduce((max, a) => (a.value > max.value ? a : max));

  let description = (text.slice(0, chosen.start) + ' ' + text.slice(chosen.end))
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:,;.@=]+|[\s\-–—:,;@=]+$/g, '');
  description = restoreTimes(input, description);
  if (!description) description = category || 'Expense';
  description = description.charAt(0).toUpperCase() + description.slice(1);

  const amountCents = Math.round(chosen.value * 100);
  if (amountCents <= 0 || amountCents > 1e15) return null;

  return {
    amountCents,
    currency: chosen.currency || defaultCurrency,
    description: description.slice(0, 200),
    category: category || guessCategory(description),
    spentOn: dated.date,
  };
}

function restoreTimes(original, description) {
  let out = description;
  for (const t of original.match(TIME_RE) || []) out = out.replace(t.replace(/\d/g, MASK), t);
  return out;
}

/**
 * Parses a reporting period. Returns null when the text is not a period.
 *   ""/"open" -> unclaimed, "all", "this month", "last month", "2026-10",
 *   "october [2026]", "2026", "2026-10-01 to 2026-10-15"
 */
export function parsePeriod(input, { today }) {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  const [ty, tm] = today.split('-').map(Number);

  if (['', 'open', 'unclaimed', 'pending'].includes(text)) {
    return { kind: 'open', label: 'Unclaimed expenses' };
  }
  if (text === 'all') return { kind: 'all', label: 'All expenses' };
  if (['month', 'this month'].includes(text)) return month(ty, tm);
  if (['last month', 'previous month'].includes(text)) {
    return tm === 1 ? month(ty - 1, 12) : month(ty, tm - 1);
  }

  let m = text.match(/^(\d{4})-(\d{1,2})$/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return month(Number(m[1]), Number(m[2]));

  m = text.match(/^(\d{4})$/);
  if (m) return { kind: 'range', from: `${m[1]}-01-01`, to: `${m[1]}-12-31`, label: `Year ${m[1]}` };

  m = text.match(/^([a-z]+)(?: (\d{4}))?$/);
  if (m) {
    const idx = MONTH_NAMES.findIndex((name) => m[1].length >= 3 && name.startsWith(m[1]));
    if (idx >= 0) {
      const mo = idx + 1;
      // a month name without a year means the most recent such month
      const y = m[2] ? Number(m[2]) : mo > tm ? ty - 1 : ty;
      return month(y, mo);
    }
  }

  m = text.match(/^(\d{4})-(\d{2})-(\d{2}) ?(?:to|-|–|\.\.) ?(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const from = isoDate(m[1], m[2], m[3]);
    const to = isoDate(m[4], m[5], m[6]);
    if (isValidDate(+m[1], +m[2], +m[3]) && isValidDate(+m[4], +m[5], +m[6]) && from <= to) {
      return { kind: 'range', from, to, label: `${from} to ${to}` };
    }
  }
  return null;
}

function month(y, m) {
  return { kind: 'range', ...monthRange(y, m), label: monthLabel(y, m) };
}

const PERIOD_COMMANDS = {
  list: 'list', ls: 'list', recent: 'list',
  total: 'total', totals: 'total', summary: 'total',
  report: 'report', reimburse: 'report', reimbursement: 'report', export: 'report',
};

/**
 * Recognises bot commands. Returns null for anything that isn't a command, and
 * { type: 'badPeriod' } when a period command has an unrecognised argument.
 */
export function parseCommand(input, { today }) {
  const m = input.trim().match(/^[/!]?([a-z]+)(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const word = m[1].toLowerCase();
  const rest = (m[2] || '').trim();

  if (['help', 'start', 'menu', 'hi', 'hello', '?'].includes(word)) return rest ? null : { type: 'help' };

  if (PERIOD_COMMANDS[word]) {
    const period = parsePeriod(rest, { today });
    return period ? { type: PERIOD_COMMANDS[word], period } : { type: 'badPeriod', arg: rest };
  }

  if (word === 'undo' && !rest) return { type: 'undo' };

  if (['delete', 'del', 'remove', 'hapus'].includes(word)) {
    const id = rest.match(/^#?(\d+)$/);
    return id ? { type: 'delete', id: Number(id[1]) } : null;
  }

  if (['claim', 'claimed', 'submitted'].includes(word) && !rest) return { type: 'claim' };

  if (word === 'name' && rest && !/\d/.test(rest)) return { type: 'name', name: rest.slice(0, 80) };

  return null;
}
