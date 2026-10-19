// Twilio WhatsApp adapter (works with the Twilio sandbox and approved senders).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizePhone } from '../config.js';

/** https://www.twilio.com/docs/usage/security#validating-requests */
export function verifyTwilioSignature(url, params, signature, authToken) {
  if (!authToken || !signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = Buffer.from(createHmac('sha1', authToken).update(data).digest('base64'));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function extractTwilioMessage(params) {
  const hasMedia = Number(params.NumMedia || 0) > 0;
  return {
    id: params.MessageSid,
    from: normalizePhone(params.From),
    text: params.Body || '',
    mediaUrl: hasMedia ? params.MediaUrl0 : null,
    mimeType: hasMedia ? params.MediaContentType0 : null,
  };
}

export function twiml(text) {
  const escaped = String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${text ? `<Message>${escaped}</Message>` : ''}</Response>`;
}

export function createTwilioMediaDownloader({ accountSid, authToken }, fetchImpl = fetch) {
  const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
  return async (url) => {
    // only send credentials to Twilio itself; fetch drops them on the redirect to the media CDN
    if (new URL(url).hostname !== 'api.twilio.com') throw new Error(`unexpected media host: ${url}`);
    const res = await fetchImpl(url, { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`media download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
}
