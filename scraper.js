/**
 * Bauhaus.es product scraper
 * ---------------------------
 * Reads URLs from input.csv (column: "Source Link")
 * Writes results to output.csv (Source Link, Product Name, Price, Brand, Category, Product Type, Description)
 *
 * Usage:
 *   npm install
 *   node scraper.js
 *
 * Resumable: if output.csv already has a row filled in for a URL, it's skipped on re-run.
 */

import fs from "fs";
import axios from "axios";
import * as cheerio from "cheerio";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import pLimit from "p-limit";

const INPUT_FILE = "input.csv";
const OUTPUT_FILE = "output.csv";
const CONCURRENCY = 5;          // how many requests in parallel
const DELAY_MS = 200;           // small delay per request to be polite
const RETRY_COUNT = 2;

const HEADERS = [
  "Source Link",
  "Product Name",
  "Price",
  "Brand",
  "Category",
  "Product Type",
  "Description",
];

function loadInput() {
  const raw = fs.readFileSync(INPUT_FILE, "utf-8");
  const records = parse(raw, { columns: true, skip_empty_lines: true });
  return records.map((r) => r["Source Link"] || r["source_link"] || r[Object.keys(r)[0]]);
}

function loadExistingOutput() {
  if (!fs.existsSync(OUTPUT_FILE)) return new Map();
  const raw = fs.readFileSync(OUTPUT_FILE, "utf-8");
  if (!raw.trim()) return new Map();
  const records = parse(raw, { columns: true, skip_empty_lines: true });
  const map = new Map();
  for (const r of records) {
    if (r["Source Link"]) map.set(r["Source Link"], r);
  }
  return map;
}

function saveOutput(map) {
  const rows = Array.from(map.values());
  const csv = stringify(rows, { header: true, columns: HEADERS });
  fs.writeFileSync(OUTPUT_FILE, csv, "utf-8");
}

async function fetchHtml(url, retries = RETRY_COUNT) {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "es-ES,es;q=0.9",
      },
    });
    return res.data;
  } catch (err) {
    if (retries > 0) {
      await sleep(500);
      return fetchHtml(url, retries - 1);
    }
    throw err;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractFromJsonLd($) {
  let product = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (product) return;
    try {
      const json = JSON.parse($(el).contents().text());
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (item["@type"] === "Product") {
          product = item;
        } else if (item["@graph"]) {
          const found = item["@graph"].find((g) => g["@type"] === "Product");
          if (found) product = found;
        }
      }
    } catch (e) {
      /* ignore invalid JSON-LD blocks */
    }
  });
  if (!product) return null;

  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;

  return {
    name: product.name || "",
    price: (offer && offer.price) || "",
    brand: (product.brand && (product.brand.name || product.brand)) || "",
    category: product.category || "",
    type: product.name || "",
    description: (product.description || "").replace(/\s+/g, " ").trim(),
  };
}

function extractFromHtml($) {
  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  const name = ogTitle.replace(/\s*\|\s*BAUHAUS\s*$/i, "") || $("h1").first().text().trim();

  // Price: look for a "X,XX €" pattern anywhere in the visible text
  const bodyText = $("body").text();
  const priceMatch = bodyText.match(/(\d{1,4}[.,]\d{2})\s*€/);
  const price = priceMatch ? priceMatch[1] : "";

  // Brand: often only appears in an image alt attribute near the top gallery
  let brand = "";
  $("img[alt]").each((_, el) => {
    if (brand) return;
    const alt = $(el).attr("alt") || "";
    const m = alt.match(/^([A-Z][a-zA-Z]+)\s+/);
    if (m) brand = m[1];
  });

  // Category: last breadcrumb link before the product page
  const breadcrumbLinks = $('a[href*="/c/"]')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const category = breadcrumbLinks.length ? breadcrumbLinks[breadcrumbLinks.length - 1] : "";

  const type = $("h1").first().text().trim();

  // Description: paragraph(s) under "Descripción del producto"
  let description = "";
  $("h2, h3").each((_, el) => {
    if (description) return;
    const heading = $(el).text().trim().toLowerCase();
    if (heading.includes("descripción del producto")) {
      const next = $(el).nextAll("p, div").first();
      description = next.text().replace(/\s+/g, " ").trim();
    }
  });

  return { name, price, brand, category, type, description };
}

async function scrapeOne(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const ldData = extractFromJsonLd($);
  const htmlData = extractFromHtml($);

  // Prefer JSON-LD fields, fall back to HTML-scraped fields per-field
  const merged = {};
  for (const key of ["name", "price", "brand", "category", "type", "description"]) {
    merged[key] = (ldData && ldData[key]) || htmlData[key] || "";
  }
  return merged;
}

async function main() {
  const urls = loadInput();
  const existing = loadExistingOutput();
  const limit = pLimit(CONCURRENCY);

  console.log(`Loaded ${urls.length} URLs. ${existing.size} already done.`);

  let processed = 0;
  const tasks = urls.map((url) =>
    limit(async () => {
      if (!url) return;
      if (existing.has(url) && existing.get(url)["Product Name"]) {
        return; // already scraped
      }
      try {
        await sleep(DELAY_MS);
        const data = await scrapeOne(url);
        existing.set(url, {
          "Source Link": url,
          "Product Name": data.name,
          Price: data.price,
          Brand: data.brand,
          Category: data.category,
          "Product Type": data.type,
          Description: data.description,
        });
        processed++;
        if (processed % 25 === 0) {
          console.log(`Processed ${processed} / ${urls.length}`);
          saveOutput(existing); // periodic checkpoint save
        }
      } catch (err) {
        console.error(`FAILED: ${url} -> ${err.message}`);
        existing.set(url, {
          "Source Link": url,
          "Product Name": "ERROR",
          Price: "",
          Brand: "",
          Category: "",
          "Product Type": "",
          Description: err.message,
        });
      }
    })
  );

  await Promise.all(tasks);
  saveOutput(existing);
  console.log("Done. Results saved to", OUTPUT_FILE);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
