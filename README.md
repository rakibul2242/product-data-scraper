# Bauhaus Product Scraper — Google Sheets Direct Integration (Puppeteer)

Reads product links straight from your Google Sheet, scrapes bauhaus.es using
a real headless Chrome browser (to bypass bot-blocking), and writes results
back directly into the same sheet.

## Setup (one-time)

### 1. Install dependencies

```bash
npm install
```

needed
because bauhaus.es blocks plain HTTP requests (403 errors) — it only allows
requests that look like they come from an actual browser.

> If you previously ran `npm install axios` etc. for an older version of this
> script, you can clean up first: `rm -rf node_modules package-lock.json`
> then run `npm install` again.

### 2. Create a Google Service Account (free)

This is a robot account Google gives your script permission to use — it's
free and takes 5 minutes.

1. Go to https://console.cloud.google.com/
2. Create a new project (or use an existing one)
3. In the search bar, go to **"Google Sheets API"** → click **Enable**
4. Go to **APIs & Services → Credentials → Create Credentials → Service Account**
5. Give it any name (e.g. `sheet-scraper`), click through the defaults, **Done**
6. Click on the service account you just created → **Keys** tab → **Add Key → Create new key → JSON**
7. A `.json` file downloads — rename it to `credentials.json` and put it in this project folder

### 3. Share your Google Sheet with the service account

1. Open `credentials.json`, find the `"client_email"` field
   (looks like `something@project-id.iam.gserviceaccount.com`)
2. Open your Google Sheet → click **Share** → paste that email → give it
   **Editor** access → Send

(This is required — otherwise the script can't read/write your sheet.)

### 4. Configure the script

Open `config.js` and fill in:

- `SPREADSHEET_ID` — from your sheet's URL:
  `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
- `SHEET_NAME` — the tab name at the bottom of your sheet (e.g. `Sheet1`)
- Column letters, if your layout differs from A (link) → B–G (data)

## Run it

```bash
node scraper.js
```

## Behavior
- It reads every row, skips any row that already has a Product Name filled in,
  scrapes the rest, and writes results back in batches (fast + fewer API calls).
- Safe to stop and re-run anytime — it picks up where it left off automatically,
  since it skips rows that already have data.

## Notes

- Google Sheets API free tier allows 300 read/write requests per minute —
  this script batches writes (default 20 rows per batch) to stay well within that.
- Scraping runs through a real headless Chrome browser (3 tabs in parallel by
  default) to avoid the site's bot detection. This is slower than plain HTTP
  requests but far more reliable against 403 errors.
- If you still see `ERROR` rows or 403s, try lowering `CONCURRENCY` to 1-2 or
  raising `DELAY_MS` in `config.js` — the site may be rate-limiting aggressively.
- `credentials.json` is in `.gitignore` — never commit this file publicly,
  it's effectively a password.
- First run may take a minute longer as Puppeteer downloads Chromium (only
  happens once, during `npm install`).

## Why the switch to Puppeteer?

bauhaus.es was returning `403 Forbidden` to plain HTTP requests (axios/curl/fetch)
even though it works fine in a normal browser — this is bot-protection that
likely checks browser-level signals (TLS handshake, JS execution, etc.) that
simple HTTP clients can't replicate. Puppeteer drives an actual (headless)
Chrome browser, so requests look identical to normal browsing.

## If you still get blocked / errors

- Lower `CONCURRENCY` in `config.js` to `1` or `2`
- Increase `DELAY_MS` (e.g. `1000`)
- If a specific row keeps failing, open that URL manually in your browser to
  confirm the product page still exists / hasn't moved
- Re-run `node scraper.js` anytime — it automatically skips rows that already
  have data in the Product Name column, so it's safe to stop and resume
