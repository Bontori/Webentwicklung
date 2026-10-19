import { parseCommand, parseExpense } from './parser.js';
import { todayIn } from './dates.js';
import { formatMoney, totalsByCurrency } from './money.js';
import { isSupportedReceipt } from './receipts.js';

// a receipt photo sent without a caption is attached to an expense logged this recently
const ATTACH_WINDOW_MS = 30 * 60_000;
const LIST_LIMIT = 30;

export const HELP_TEXT = `📒 *Expense bot*

Log an expense by just sending it:
• lunch with client 45000
• taxi $12.50 #transport
• hotel 1.250.000 IDR yesterday
• dinner 320k 15/10
• 📷 a receipt photo with a caption like "dinner 320k"

Commands:
• *list* [period] – show expenses
• *total* [period] – totals per currency
• *report* [period] – reimbursement report link
• *claim* – mark your last report as submitted
• *undo* – delete the last expense
• *delete* <id> – delete an expense
• *name* <your name> – shown on reports

Periods: this month, last month, october, 2026-10, 2026-10-01 to 2026-10-15, all.
Without a period you get everything not yet claimed.`;

/**
 * msg: { id?, from, text?, media?: { mimeType, download(): Promise<Buffer> } }
 * Returns the reply text, or null when nothing should be sent.
 */
export function createBot({ store, receipts, config, now = () => new Date() }) {
  const money = (cents, currency) => formatMoney(cents, currency, config.locale);
  const today = () => todayIn(config.timezone, now());

  const describe = (e) =>
    `#${e.id} ${e.spent_on} · ${e.description} · ${money(e.amount_cents, e.currency)} · ${e.category}` +
    (e.receipt ? ' 📎' : '');

  const totalsLine = (expenses) =>
    totalsByCurrency(expenses)
      .map((t) => money(t.amountCents, t.currency))
      .join(' + ');

  async function attachReceipt(expense, media) {
    const data = await media.download();
    if (expense.receipt) receipts.remove(expense.receipt);
    const name = receipts.save(expense.id, data, media.mimeType);
    store.setReceipt(expense.id, name);
    return { ...expense, receipt: name };
  }

  const commands = {
    help: () => HELP_TEXT,

    list(phone, { period }) {
      const rows = store.listExpenses(phone, period);
      if (!rows.length) return `No expenses for: ${period.label}.`;
      const shown = rows.slice(-LIST_LIMIT);
      const more = rows.length > shown.length ? `\n…and ${rows.length - shown.length} earlier` : '';
      return `*${period.label}* (${rows.length})\n${shown.map(describe).join('\n')}${more}\n\nTotal: ${totalsLine(rows)}`;
    },

    total(phone, { period }) {
      const rows = store.listExpenses(phone, period);
      if (!rows.length) return `No expenses for: ${period.label}.`;
      const byCategory = new Map();
      for (const e of rows) {
        const key = `${e.category}|${e.currency}`;
        byCategory.set(key, (byCategory.get(key) || 0) + e.amount_cents);
      }
      const lines = [...byCategory]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, cents]) => `• ${key.split('|')[0]}: ${money(cents, key.split('|')[1])}`);
      return `*${period.label}* — ${rows.length} expense(s)\n${lines.join('\n')}\n\n*Total: ${totalsLine(rows)}*`;
    },

    report(phone, { period }) {
      const rows = store.listExpenses(phone, period);
      if (!rows.length) return `No expenses for: ${period.label}, so there is nothing to report.`;
      const report = store.createReport({
        phone,
        title: period.label,
        expenseIds: rows.map((e) => e.id),
        ttlHours: config.reportTtlHours,
      });
      const url = `${config.publicBaseUrl}/r/${report.token}`;
      const missing = rows.filter((e) => !e.receipt).length;
      return [
        `🧾 *Reimbursement report ${reportNumber(report)}* — ${period.label}`,
        `${rows.length} expense(s) · ${totalsLine(rows)}`,
        missing ? `⚠️ ${missing} without a receipt` : '✅ All receipts attached',
        '',
        `View / print / save as PDF:\n${url}`,
        `Spreadsheet (CSV):\n${url}/csv`,
        '',
        `The link expires in ${config.reportTtlHours}h. After you submit it, reply *claim* so these expenses aren't reported again.`,
      ].join('\n');
    },

    claim(phone) {
      const report = store.latestReport(phone);
      if (!report) return 'You have no reports yet. Send *report* first.';
      const count = store.markClaimed(phone, report.expenseIds);
      if (!count) return `Everything in report ${reportNumber(report)} is already marked as claimed.`;
      return `✅ Marked ${count} expense(s) from report ${reportNumber(report)} as claimed.`;
    },

    undo(phone) {
      const last = store.lastExpense(phone);
      if (!last) return 'There is nothing to undo.';
      return commands.delete(phone, { id: last.id });
    },

    delete(phone, { id }) {
      const row = store.deleteExpense(phone, id);
      if (!row) return `Expense #${id} not found.`;
      if (row.receipt) receipts.remove(row.receipt);
      return `🗑️ Deleted ${describe({ ...row, receipt: null })}`;
    },

    name(phone, { name }) {
      store.setName(phone, name);
      return `👤 Reports will now show the name *${name}*.`;
    },
  };

  async function handle(msg) {
    if (msg.id && !store.markProcessed(msg.id)) return null;
    const phone = msg.from;
    if (config.allowedNumbers.length && !config.allowedNumbers.includes(phone)) return null;
    store.getUser(phone);

    const text = (msg.text || '').trim();
    const media = msg.media && isSupportedReceipt(msg.media.mimeType) ? msg.media : null;
    if (msg.media && !media) return 'Please send receipts as a photo (JPG/PNG) or PDF.';
    if (!text && !media) return 'I can only read text messages and receipt photos. Send *help* for examples.';

    const ctx = { today: today(), defaultCurrency: config.defaultCurrency };

    if (!text) {
      const last = store.lastExpense(phone);
      const recent = last && now() - new Date(last.created_at) < ATTACH_WINDOW_MS;
      if (!recent) {
        return 'Got the photo, but which expense is it for? Resend it with a caption like "taxi 85000".';
      }
      const updated = await attachReceipt(last, media);
      return `📎 Receipt attached to ${describe(updated)}`;
    }

    const command = media ? null : parseCommand(text, ctx);
    if (command && command.type !== 'badPeriod') return commands[command.type](phone, command);

    const parsed = parseExpense(text, ctx);
    if (!parsed) {
      if (command) {
        return `I don't understand the period "${command.arg}". Try: this month, last month, october, 2026-10, all.`;
      }
      return 'I couldn\'t find an amount in that. Try "lunch 45000" or send *help*.';
    }

    let expense = store.addExpense({ phone, ...parsed });
    let warning = '';
    if (media) {
      try {
        expense = await attachReceipt(expense, media);
      } catch (err) {
        console.error(`receipt download failed for expense #${expense.id}:`, err);
        warning = '\n⚠️ The receipt could not be downloaded. Please send the photo again.';
      }
    }
    return `✅ Recorded ${describe(expense)}${warning}\nReply *undo* to remove it.`;
  }

  return { handle };
}

export function reportNumber(report) {
  return `R-${report.created_at.slice(0, 4)}-${String(report.id).padStart(4, '0')}`;
}
