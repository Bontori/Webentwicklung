import { formatMoney, totalsByCurrency } from './money.js';
import { reportNumber } from './bot.js';

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const isImage = (name) => /\.(jpe?g|png|webp)$/i.test(name || '');

function categorySummary(expenses) {
  const rows = new Map();
  for (const e of expenses) {
    const key = `${e.category}\u0000${e.currency}`;
    const row = rows.get(key) || { category: e.category, currency: e.currency, amountCents: 0, count: 0 };
    row.amountCents += e.amount_cents;
    row.count += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.category.localeCompare(b.category) || a.currency.localeCompare(b.currency));
}

/** Renders a self-contained, print-ready HTML reimbursement report. */
export function renderReportHtml({ report, user, expenses, config, basePath }) {
  const money = (cents, currency) => escapeHtml(formatMoney(cents, currency, config.locale));
  const totals = totalsByCurrency(expenses);
  const dates = expenses.map((e) => e.spent_on).sort();
  const span = dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : '—';
  const number = reportNumber(report);

  const rows = expenses
    .map(
      (e, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(e.spent_on)}</td>
        <td>${escapeHtml(e.description)}<span class="ref">#${e.id}${e.status === 'claimed' ? ' · claimed' : ''}</span></td>
        <td>${escapeHtml(e.category)}</td>
        <td class="amt">${money(e.amount_cents, e.currency)}</td>
        <td class="rcpt">${e.receipt ? `<a href="${basePath}/receipts/${e.id}">View</a>` : '<span class="missing">Missing</span>'}</td>
      </tr>`,
    )
    .join('');

  const summary = categorySummary(expenses)
    .map((s) => `<tr><td>${escapeHtml(s.category)}</td><td class="num">${s.count}</td><td class="amt">${money(s.amountCents, s.currency)}</td></tr>`)
    .join('');

  const totalRows = totals
    .map((t) => `<tr class="total"><td colspan="4">Total ${escapeHtml(t.currency)} (${t.count} item${t.count === 1 ? '' : 's'})</td><td class="amt">${money(t.amountCents, t.currency)}</td><td></td></tr>`)
    .join('');

  const withReceipts = expenses.filter((e) => e.receipt);
  const appendix = withReceipts
    .map(
      (e) => `
      <figure class="receipt">
        <figcaption>#${e.id} · ${escapeHtml(e.spent_on)} · ${escapeHtml(e.description)} · ${money(e.amount_cents, e.currency)}</figcaption>
        ${
          isImage(e.receipt)
            ? `<img src="${basePath}/receipts/${e.id}" alt="Receipt for expense #${e.id}">`
            : `<p><a href="${basePath}/receipts/${e.id}">Open receipt file (${escapeHtml(e.receipt.split('.').pop().toUpperCase())})</a></p>`
        }
      </figure>`,
    )
    .join('');

  const multiCurrency = totals.length > 1;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Expense Report ${escapeHtml(number)}</title>
<style>
  :root { --ink: #1c2430; --muted: #5d6b7c; --line: #dbe1e8; --bg: #f4f6f9; --paper: #fff; --accent: #0b7a5a; --warn: #b4441c; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .page { max-width: 960px; margin: 24px auto; background: var(--paper); padding: 40px 48px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  header { display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap; border-bottom: 2px solid var(--ink); padding-bottom: 16px; }
  h1 { margin: 0; font-size: 24px; letter-spacing: -.01em; }
  h2 { font-size: 16px; margin: 32px 0 8px; }
  .company { color: var(--muted); font-weight: 600; text-transform: uppercase; font-size: 12px; letter-spacing: .06em; }
  dl { display: grid; grid-template-columns: auto auto; gap: 2px 16px; margin: 0; }
  dt { color: var(--muted); } dd { margin: 0; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .num { text-align: right; width: 1%; white-space: nowrap; }
  .amt { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ref { display: block; color: var(--muted); font-size: 12px; }
  .missing { color: var(--warn); font-weight: 600; }
  .rcpt a { color: var(--accent); }
  tr.total td { font-weight: 700; border-top: 2px solid var(--ink); border-bottom: none; }
  .summary { max-width: 480px; }
  .note { color: var(--muted); font-size: 12px; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 56px; }
  .signatures div { border-top: 1px solid var(--ink); padding-top: 6px; color: var(--muted); }
  .actions { display: flex; gap: 8px; justify-content: flex-end; max-width: 960px; margin: 16px auto 0; padding: 0 16px; }
  .actions a, .actions button { font: inherit; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--line); background: var(--paper); color: var(--ink); cursor: pointer; text-decoration: none; }
  .actions button { background: var(--accent); color: #fff; border-color: var(--accent); }
  .receipt { margin: 0 0 24px; break-inside: avoid; }
  .receipt figcaption { font-weight: 600; margin-bottom: 6px; }
  .receipt img { max-width: 100%; max-height: 900px; border: 1px solid var(--line); }
  @media (max-width: 640px) {
    .page { padding: 20px 16px; margin: 8px; }
    th:nth-child(4), td:nth-child(4) { display: none; }
    .signatures { grid-template-columns: 1fr; }
  }
  @media print {
    body { background: #fff; }
    .page { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    .actions { display: none; }
    .appendix { break-before: page; }
    a { color: inherit; text-decoration: none; }
  }
</style>
</head>
<body>
<div class="actions">
  <a href="${basePath}/csv">Download CSV</a>
  <button type="button" onclick="window.print()">Print / Save as PDF</button>
</div>
<main class="page">
  <header>
    <div>
      ${config.companyName ? `<div class="company">${escapeHtml(config.companyName)}</div>` : ''}
      <h1>Expense Reimbursement Report</h1>
      <div>${escapeHtml(report.title)}</div>
    </div>
    <dl>
      <dt>Report no.</dt><dd>${escapeHtml(number)}</dd>
      <dt>Employee</dt><dd>${escapeHtml(user?.name || '—')}</dd>
      <dt>WhatsApp</dt><dd>+${escapeHtml(report.phone)}</dd>
      <dt>Expense dates</dt><dd>${escapeHtml(span)}</dd>
      <dt>Generated</dt><dd>${escapeHtml(report.created_at.slice(0, 10))}</dd>
    </dl>
  </header>

  <h2>Expenses</h2>
  ${
    expenses.length
      ? `<table>
    <thead><tr><th class="num">#</th><th>Date</th><th>Description</th><th>Category</th><th class="amt">Amount</th><th>Receipt</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>${totalRows}</tfoot>
  </table>`
      : '<p>All expenses in this report have been deleted.</p>'
  }
  ${multiCurrency ? '<p class="note">This report contains several currencies. Totals are shown per currency; no exchange rates were applied.</p>' : ''}

  ${
    expenses.length
      ? `<h2>Summary by category</h2>
  <table class="summary">
    <thead><tr><th>Category</th><th class="num">Items</th><th class="amt">Amount</th></tr></thead>
    <tbody>${summary}</tbody>
  </table>`
      : ''
  }

  <p class="note">I certify that these expenses were incurred for business purposes and have not been reimbursed before.</p>
  <div class="signatures">
    <div>Employee signature &amp; date</div>
    <div>Approved by &amp; date</div>
  </div>

  ${withReceipts.length ? `<section class="appendix"><h2>Receipts</h2>${appendix}</section>` : ''}
</main>
</body>
</html>`;
}

const csvCell = (value) => {
  let s = String(value ?? '');
  // stop spreadsheet apps from evaluating user-supplied text as a formula
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function renderReportCsv({ expenses, receiptUrl }) {
  const header = ['ID', 'Date', 'Description', 'Category', 'Amount', 'Currency', 'Status', 'Receipt'];
  const lines = expenses.map((e) =>
    [
      e.id,
      e.spent_on,
      csvCell(e.description),
      csvCell(e.category),
      (e.amount_cents / 100).toFixed(2),
      e.currency,
      e.status,
      e.receipt ? receiptUrl(e) : '',
    ].join(','),
  );
  // BOM so Excel opens the file as UTF-8
  return '﻿' + [header.join(','), ...lines].join('\r\n') + '\r\n';
}
