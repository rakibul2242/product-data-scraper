import puppeteer from "puppeteer";
import pLimit from "p-limit";
import config from "./config.js";
import { readLinks, writeBatch } from "./sheets.js";
import { scrapeProduct } from "./extractor.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function progress(done, total) {
  const pct = Math.round((done / total) * 100);
  const filled = Math.round((done / total) * 30);
  const bar = "█".repeat(filled) + "░".repeat(30 - filled);
  return `${c.cyan}${bar}${c.reset} ${c.bold}${pct}%${c.reset} ${c.dim}(${done}/${total})${c.reset}`;
}

function formatTime(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function main() {
  const startTime = Date.now();

  console.log(`\n${c.bold}╔══════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}║      🛠  Bauhaus Product Scraper         ║${c.reset}`);
  console.log(`${c.bold}╚══════════════════════════════════════════╝${c.reset}\n`);

  console.log(`${c.cyan}►${c.reset} Reading links from Google Sheet...`);
  const rows = await readLinks();
  console.log(`${c.green}✓${c.reset} Found ${c.bold}${rows.length}${c.reset} rows total\n`);

  const todo = rows.filter((r) => r.url && !r.productName);
  const doneskipped = rows.length - todo.length;

  console.log(`${c.yellow}→${c.reset} ${c.bold}${todo.length}${c.reset} need scraping`);
  console.log(`${c.green}→${c.reset} ${c.bold}${doneskipped}${c.reset} already have data (skipped)\n`);

  if (todo.length === 0) {
    console.log(`${c.green}${c.bold}Nothing to do — all rows already have data.${c.reset}\n`);
    return;
  }

  console.log(`${c.cyan}►${c.reset} Config: ${c.dim}concurrency=${config.CONCURRENCY}, delay=${config.DELAY_MS}ms, batch=${config.BATCH_SIZE}${c.reset}`);
  console.log(`${c.cyan}►${c.reset} Fields: ${c.dim}${config.FIELDS.join(", ")}${c.reset}`);
  console.log(`${c.cyan}►${c.reset} Launching headless browser...\n`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const limit = pLimit(config.CONCURRENCY);
  let pendingBatch = [];
  let done = 0;
  let failed = 0;

  try {
    const tasks = todo.map((item) =>
      limit(async () => {
        const itemStart = Date.now();
        try {
          await sleep(config.DELAY_MS);
          const data = await scrapeProduct(browser, item.url);
          pendingBatch.push({ row: item.row, data });
          const elapsed = Date.now() - itemStart;
          console.log(
            `${c.green}✓${c.reset} Row ${c.bold}${item.row}${c.reset} ${c.dim}(${formatTime(elapsed)})${c.reset} ${progress(done + 1, todo.length)}`
          );
        } catch (err) {
          failed++;
          const elapsed = Date.now() - itemStart;
          console.error(
            `${c.red}✗${c.reset} Row ${c.bold}${item.row}${c.reset} ${c.red}${err.message}${c.reset} ${c.dim}(${formatTime(elapsed)})${c.reset} ${progress(done + 1, todo.length)}`
          );
          pendingBatch.push({
            row: item.row,
            data: {
              name: "ERROR",
              price: "",
              brand: "",
              category: "",
              type: "",
              description: err.message,
            },
          });
        }

        done++;
        if (pendingBatch.length >= config.BATCH_SIZE) {
          const toWrite = pendingBatch;
          pendingBatch = [];
          await writeBatch(toWrite);
          console.log(`${c.cyan}►${c.reset} Batch of ${c.bold}${toWrite.length}${c.reset} rows written to sheet\n`);
        }
      })
    );

    await Promise.all(tasks);

    if (pendingBatch.length > 0) {
      await writeBatch(pendingBatch);
      console.log(`${c.cyan}►${c.reset} Final batch of ${c.bold}${pendingBatch.length}${c.reset} rows written to sheet\n`);
    }
  } finally {
    await browser.close();
  }

  const totalTime = Date.now() - startTime;
  console.log(`${c.bold}╔══════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}║  Done!                                   ║${c.reset}`);
  console.log(`${c.bold}╚══════════════════════════════════════════╝${c.reset}`);
  console.log(`${c.green}✓${c.reset} Scraped:  ${c.bold}${done - failed}${c.reset} rows`);
  if (failed > 0) {
    console.log(`${c.red}✗${c.reset} Failed:   ${c.bold}${failed}${c.reset} rows`);
  }
  console.log(`${c.cyan}►${c.reset} Time:     ${c.bold}${formatTime(totalTime)}${c.reset}`);
  console.log(`${c.cyan}►${c.reset} Average:  ${c.bold}${formatTime(Math.round(totalTime / todo.length))}${c.reset} per product\n`);
}

main().catch((err) => {
  console.error(`\n${c.red}${c.bold}Fatal error:${c.reset} ${err.message}\n`);
  process.exit(1);
});