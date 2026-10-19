// WhatsApp Business Cloud API (Meta) adapter.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizePhone } from '../config.js';

const MAX_TEXT = 4096;

export function verifyMetaSignature(rawBody, header, appSecret) {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const given = Buffer.from(header.slice('sha256='.length));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Flattens a webhook payload into [{ id, from, type, text, mediaId, mimeType }]. */
export function extractMetaMessages(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      for (const m of change.value?.messages || []) {
        const media = m.image || m.document || null;
        out.push({
          id: m.id,
          from: normalizePhone(m.from),
          type: m.type,
          text: m.text?.body ?? media?.caption ?? '',
          mediaId: media?.id || null,
          mimeType: media?.mime_type || null,
          unsupported: !['text', 'image', 'document'].includes(m.type),
        });
      }
    }
  }
  return out;
}

export function createMetaClient({ accessToken, phoneNumberId, graphVersion }, fetchImpl = fetch) {
  const base = `https://graph.facebook.com/${graphVersion}`;
  const auth = { Authorization: `Bearer ${accessToken}` };

  async function check(res, what) {
    if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text().catch(() => '')}`);
    return res;
  }

  return {
    async sendText(to, body) {
      const text = body.length > MAX_TEXT ? `${body.slice(0, MAX_TEXT - 1)}…` : body;
      await check(
        await fetchImpl(`${base}/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
        }),
        'send message',
      );
    },

    async downloadMedia(mediaId) {
      const info = await (await check(await fetchImpl(`${base}/${mediaId}`, { headers: auth }), 'media lookup')).json();
      const file = await check(await fetchImpl(info.url, { headers: auth }), 'media download');
      return Buffer.from(await file.arrayBuffer());
    },
  };
}
