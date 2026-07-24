import * as cheerio from "cheerio";
import config from "./config.js";

// Maps config field names to internal extraction keys
const FIELD_MAP = {
  productName: "name",
  price: "price",
  brand: "brand",
  category: "category",
  productType: "type",
  description: "description",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches a page using a real headless Chrome browser (via Puppeteer)
 * instead of a raw HTTP request. bauhaus.es returns 403 to plain HTTP
 * libraries (axios, fetch, curl) — it works fine in your actual browser,
 * so we drive a real (headless) browser page instead, which behaves
 * exactly like Chrome.
 */
export async function fetchHtml(browser, url, retries = 2) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "es-ES,es;q=0.9" });

    // Block images/fonts/media so pages load faster — we only need the HTML
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image", "font", "media"].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    return await page.content();
  } catch (err) {
    if (retries > 0) {
      await sleep(1000);
      return fetchHtml(browser, url, retries - 1);
    }
    throw err;
  } finally {
    await page.close();
  }
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

  const bodyText = $("body").text();
  const priceMatch = bodyText.match(/(\d{1,4}[.,]\d{2})\s*€/);
  const price = priceMatch ? priceMatch[1] : "";

  let brand = "";
  $("img[alt]").each((_, el) => {
    if (brand) return;
    const alt = $(el).attr("alt") || "";
    const m = alt.match(/^([A-Z][a-zA-Z]+)\s+/);
    if (m) brand = m[1];
  });

  const breadcrumbLinks = $('a[href*="/c/"]')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const category = breadcrumbLinks.length ? breadcrumbLinks[breadcrumbLinks.length - 1] : "";

  const type = $("h1").first().text().trim();

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

export async function scrapeProduct(browser, url) {
  const html = await fetchHtml(browser, url);
  const $ = cheerio.load(html);

  const ldData = extractFromJsonLd($);
  const htmlData = extractFromHtml($);

  const wantedInternal = config.FIELDS.map((f) => FIELD_MAP[f]).filter(Boolean);

  const merged = {};
  for (const key of wantedInternal) {
    merged[key] = (ldData && ldData[key]) || htmlData[key] || "";
  }
  return merged;
}