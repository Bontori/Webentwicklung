# WhatsApp Expense Bot

Send your expenses to a WhatsApp number as you spend. The bot records them, keeps the
receipt photos, and gives you a printable reimbursement report (HTML → PDF) plus a
CSV for spreadsheets.

```
you> Grab to airport Rp 85.000 15/10
bot> ✅ Recorded #1 2026-10-15 · Grab to airport · IDR 85,000 · Transport

you> 📷 [photo] Hotel 1.250.000 IDR 16/10 #lodging
bot> ✅ Recorded #2 2026-10-16 · Hotel · IDR 1,250,000 · Lodging 📎

you> report
bot> 🧾 Reimbursement report R-2026-0001 — Unclaimed expenses
     2 expense(s) · IDR 1,335,000
     View / print / save as PDF: https://your-server/r/…
```

No npm dependencies: it uses Node's built-in `node:sqlite`, `node:http` and `fetch`.
Requires **Node.js 22.13 or newer**.

## What you can send

| Message | Meaning |
| --- | --- |
| `lunch with client 45000` | Expense in your default currency, dated today |
| `taxi $12.50 #transport` | Currency symbol, plus a category via hashtag |
| `hotel 1.250.000 IDR yesterday` | Currency code; `yesterday`, `15/10`, `2026-10-15` set the date |
| `dinner 320k` / `snacks 50rb` / `laptop 1.5jt` | `k`/`rb` = thousand, `jt`/`m` = million |
| 📷 photo or PDF **with a caption** like the above | Expense with the receipt attached |
| 📷 photo **without** a caption | Attached to the expense you logged in the last 30 min |
| `list [period]` | Show expenses with their `#id` |
| `total [period]` | Totals per category and currency |
| `report [period]` | Report link (web page, printable to PDF) + CSV link |
| `claim` | Mark the expenses in your **last report** as claimed |
| `undo` / `delete 12` | Remove the last expense / expense #12 |
| `name Jane Doe` | Name printed on your reports |
| `help` | Show all of this |

**Periods:** `this month`, `last month`, `october`, `oct 2025`, `2026-10`, `2026`,
`2026-10-01 to 2026-10-15`, `all`. With no period you get everything **not yet
claimed**. The usual cycle is: log expenses → `report` → submit the PDF → `claim`.

If you don't add a hashtag, the bot guesses the category from keywords (lunch → Meals,
grab/taxi → Transport, hotel → Lodging, flight → Travel, ...), or uses *Other*.

### Parsing rules worth knowing
- `12.500` and `12,500` are read as **twelve thousand five hundred**, because a single
  separator followed by exactly three digits is treated as a thousands separator. Write
  `12.50` for twelve and a half.
- When a message has several numbers, the bot uses the one with a currency marker. If
  none has one, it takes the largest (`Flight GA 402 1500000` → 1,500,000).
- Three-letter currency codes must be upper case (`USD`, not `usd`) so words like
  "for" are never mistaken for currencies.
- Every reply echoes what was recorded, so if the bot misreads a message, send `undo`
  and rephrase it.
- Totals are kept **per currency**. No exchange-rate conversion is done.

## Try it locally (no WhatsApp needed)

```bash
cd whatsapp-expense-bot
cp .env.example .env          # set DEFAULT_CURRENCY, TIMEZONE, ALLOWED_NUMBERS
npm start                     # terminal 1: serves report links on :3000
npm run simulate              # terminal 2: chat with the bot
```

In the simulator, send a receipt with `/photo path/to/receipt.jpg lunch 45000`.

Run the tests with `npm test`.

## Connect it to WhatsApp

The server has to be reachable over **HTTPS** from the internet. For testing, use a
tunnel such as `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`,
and set `PUBLIC_BASE_URL` to the tunnel's URL. For permanent use, deploy it to any
small VPS or container host that has a **persistent disk** (the SQLite database and the
receipts live in `DATA_DIR`).

Choose **one** provider:

### Option A: WhatsApp Cloud API (Meta, official)
1. At developers.facebook.com, create an app of type *Business* and add the
   **WhatsApp** product. Meta gives you a test number. You can also add your own number.
2. Copy the **Phone number ID** and an **access token** into `META_PHONE_NUMBER_ID`
   and `META_ACCESS_TOKEN`. Temporary tokens expire after about 24h, so for real use
   create a *System User* token in Business Settings.
3. Copy the **App secret** (App settings → Basic) into `META_APP_SECRET`. The bot
   rejects any webhook call that isn't signed with it.
4. Under WhatsApp → Configuration → Webhook, set the callback URL to
   `https://<your-server>/webhook/meta` and the verify token to `META_VERIFY_TOKEN`.
   Then subscribe to the **messages** field.
5. With the test number, add your own phone as an allowed recipient.

### Option B: Twilio
1. In the Twilio console, open *Messaging → Try it out → Send a WhatsApp message* and
   join the sandbox from your phone.
2. Set the sandbox's *When a message comes in* URL to
   `https://<your-server>/webhook/twilio` (HTTP POST).
3. Put `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` in `.env`. `PUBLIC_BASE_URL` must
   match the URL Twilio calls **exactly**, because it is part of the signature check.

Provider setup screens, pricing, and the default `META_GRAPH_VERSION` change over time,
so check them against the current Meta/Twilio docs.

## Security & privacy
- **Set `ALLOWED_NUMBERS`.** Messages from any other number are ignored silently. If it
  is empty, anyone who finds the bot's number can log expenses.
- Webhooks are verified (Meta: `X-Hub-Signature-256`; Twilio: `X-Twilio-Signature`).
- Report links use a random 192-bit token, expire after `REPORT_LINK_TTL_HOURS`
  (default 72), and are sent with `no-store`/`no-referrer`/`noindex` headers. **Anyone
  holding the link can view the report and its receipts until it expires.** Only
  forward it to the people who should see it. Receipt URLs inside the CSV expire with it.
- A report is a snapshot of *which* expenses it covers. Amounts are read live, so a
  deleted expense disappears from an existing report link.
- Receipts and the database are stored unencrypted in `DATA_DIR`. Back that folder up.

## Project layout

```
src/
  index.js          server entry point
  simulate.js       terminal chat for local testing
  app.js            config + db + bot wiring
  server.js         HTTP routes: webhooks, report page, CSV, receipt files
  bot.js            conversation logic and replies
  parser.js         free-text → expense / command / period
  db.js             SQLite storage (users, expenses, reports)
  report.js         HTML report and CSV rendering
  receipts.js       receipt file storage
  whatsapp/meta.js  Meta Cloud API: signature check, payload parsing, send, media
  whatsapp/twilio.js Twilio: signature check, TwiML reply, media download
test/               node:test suites (parser, bot, HTTP/webhooks)
```
