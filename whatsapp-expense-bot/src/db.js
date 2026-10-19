import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    phone      TEXT PRIMARY KEY,
    name       TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    phone        TEXT NOT NULL,
    spent_on     TEXT NOT NULL,
    description  TEXT NOT NULL,
    category     TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency     TEXT NOT NULL,
    receipt      TEXT,
    status       TEXT NOT NULL DEFAULT 'open',
    claimed_at   TEXT,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS expenses_phone_date ON expenses (phone, spent_on);
  CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token       TEXT NOT NULL UNIQUE,
    phone       TEXT NOT NULL,
    title       TEXT NOT NULL,
    expense_ids TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS processed_messages (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL
  );
`;

export function openStore(file, { now = () => new Date() } = {}) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const stamp = () => now().toISOString();

  const periodFilter = (period) => {
    if (period.kind === 'open') return { sql: "AND status = 'open'", args: [] };
    if (period.kind === 'range') return { sql: 'AND spent_on BETWEEN ? AND ?', args: [period.from, period.to] };
    return { sql: '', args: [] };
  };

  return {
    db,

    /** Returns false when the message id was already handled (webhook retries). */
    markProcessed(messageId) {
      const { changes } = db
        .prepare('INSERT OR IGNORE INTO processed_messages (id, at) VALUES (?, ?)')
        .run(messageId, stamp());
      return changes > 0;
    },

    getUser(phone) {
      db.prepare('INSERT OR IGNORE INTO users (phone, created_at) VALUES (?, ?)').run(phone, stamp());
      return db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    },

    setName(phone, name) {
      this.getUser(phone);
      db.prepare('UPDATE users SET name = ? WHERE phone = ?').run(name, phone);
    },

    addExpense({ phone, spentOn, description, category, amountCents, currency }) {
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO expenses (phone, spent_on, description, category, amount_cents, currency, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(phone, spentOn, description, category, amountCents, currency, stamp());
      return this.getExpense(phone, Number(lastInsertRowid));
    },

    setReceipt(id, receipt) {
      db.prepare('UPDATE expenses SET receipt = ? WHERE id = ?').run(receipt, id);
    },

    getExpense(phone, id) {
      return db.prepare('SELECT * FROM expenses WHERE phone = ? AND id = ?').get(phone, id);
    },

    lastExpense(phone) {
      return db.prepare('SELECT * FROM expenses WHERE phone = ? ORDER BY id DESC LIMIT 1').get(phone);
    },

    deleteExpense(phone, id) {
      const row = this.getExpense(phone, id);
      if (row) db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
      return row;
    },

    listExpenses(phone, period) {
      const filter = periodFilter(period);
      return db
        .prepare(`SELECT * FROM expenses WHERE phone = ? ${filter.sql} ORDER BY spent_on, id`)
        .all(phone, ...filter.args);
    },

    expensesByIds(phone, ids) {
      if (!ids.length) return [];
      return db
        .prepare(
          `SELECT * FROM expenses WHERE phone = ? AND id IN (${ids.map(() => '?').join(',')})
           ORDER BY spent_on, id`,
        )
        .all(phone, ...ids);
    },

    markClaimed(phone, ids) {
      if (!ids.length) return 0;
      const { changes } = db
        .prepare(
          `UPDATE expenses SET status = 'claimed', claimed_at = ?
           WHERE phone = ? AND status = 'open' AND id IN (${ids.map(() => '?').join(',')})`,
        )
        .run(stamp(), phone, ...ids);
      return Number(changes);
    },

    createReport({ phone, title, expenseIds, ttlHours }) {
      const token = randomBytes(24).toString('base64url');
      const created = now();
      const expires = new Date(created.getTime() + ttlHours * 3600_000);
      db.prepare(
        `INSERT INTO reports (token, phone, title, expense_ids, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(token, phone, title, JSON.stringify(expenseIds), created.toISOString(), expires.toISOString());
      const row = db.prepare('SELECT * FROM reports WHERE token = ?').get(token);
      return { ...row, expenseIds };
    },

    /** Returns the report for a token, or null if unknown or expired. */
    getReport(token) {
      const row = db.prepare('SELECT * FROM reports WHERE token = ?').get(token);
      if (!row || row.expires_at <= stamp()) return null;
      return { ...row, expenseIds: JSON.parse(row.expense_ids) };
    },

    latestReport(phone) {
      const row = db.prepare('SELECT * FROM reports WHERE phone = ? ORDER BY id DESC LIMIT 1').get(phone);
      return row ? { ...row, expenseIds: JSON.parse(row.expense_ids) } : null;
    },
  };
}
