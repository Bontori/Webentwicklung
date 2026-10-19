import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

export const CONTENT_TYPES = Object.fromEntries(Object.entries(EXTENSIONS).map(([t, e]) => [e, t]));

export function isSupportedReceipt(mimeType) {
  return Boolean(EXTENSIONS[(mimeType || '').split(';')[0].trim()]);
}

export function createReceiptStore(dir) {
  mkdirSync(dir, { recursive: true });
  return {
    save(expenseId, data, mimeType) {
      const ext = EXTENSIONS[mimeType.split(';')[0].trim()];
      const name = `${expenseId}-${randomBytes(6).toString('hex')}.${ext}`;
      writeFileSync(path.join(dir, name), data);
      return name;
    },
    /** Resolves a stored receipt name to an absolute path, refusing path traversal. */
    resolve(name) {
      const file = path.join(dir, path.basename(name));
      return existsSync(file) ? file : null;
    },
    remove(name) {
      const file = this.resolve(name);
      if (file) unlinkSync(file);
    },
  };
}
