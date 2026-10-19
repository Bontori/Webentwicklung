const formatters = new Map();

export function formatMoney(amountCents, currency, locale = 'en-US') {
  const whole = amountCents % 100 === 0;
  const key = `${locale}|${currency}|${whole}`;
  if (!formatters.has(key)) {
    let fmt;
    try {
      fmt = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        currencyDisplay: 'code',
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: 2,
      });
    } catch {
      fmt = { format: (n) => `${currency} ${n.toFixed(whole ? 0 : 2)}` };
    }
    formatters.set(key, fmt);
  }
  // Intl puts a non-breaking space between code and number; plain spaces read better in chat
  return formatters.get(key).format(amountCents / 100).replace(/ /g, ' ');
}

/** Sums expenses per currency: [{ currency, amountCents, count }] sorted by currency. */
export function totalsByCurrency(expenses) {
  const totals = new Map();
  for (const e of expenses) {
    const t = totals.get(e.currency) || { currency: e.currency, amountCents: 0, count: 0 };
    t.amountCents += e.amount_cents;
    t.count += 1;
    totals.set(e.currency, t);
  }
  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
