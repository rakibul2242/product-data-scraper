import "dotenv/config";

/**
 * Fill these in before running.
 */
export default {
  // The long ID in your Google Sheet's URL:
  // https://docs.google.com/spreadsheets/d/  <-- THIS PART -->  /edit
  SPREADSHEET_ID: process.env.SPREADSHEET_ID,

  // Name of the tab (bottom tab label) that has your links + headers
  SHEET_NAME: process.env.SHEET_NAME || "Sheet1",

  // Path to the service account JSON key file (see README for how to get this)
  CREDENTIALS_PATH: process.env.CREDENTIALS_PATH || "./credentials.json",

  // Column layout (A=1, B=2, C=3, ...) — matches your screenshot
  COLUMNS: {
    sourceLink: "A",
    productName: "B",
    price: "C",
    // brand: "D",
    category: "E",
    productType: "F",
    description: "D",
  },

  // Which fields to extract — comment out or remove any you don't need
  // These must match the keys used in COLUMNS above (minus sourceLink)
  // All fields
  // FIELDS: ["productName", "price", "brand", "category", "productType", "description"],

  // Name, price, and brand
  FIELDS: ["productName", "price", "description"],

  // First row with actual data (row 1 = headers)
  START_ROW: Number(process.env.START_ROW) || 2,

  // How many rows to write per batch (fewer Sheets API calls)
  BATCH_SIZE: Number(process.env.BATCH_SIZE) || 25,

  // How many browser pages/tabs open at once (keep modest — each is a real
  // Chrome tab and uses real memory/CPU)
  CONCURRENCY: Number(process.env.CONCURRENCY) || 3,

  // Small delay per request to avoid hammering the site
  DELAY_MS: Number(process.env.DELAY_MS) || 400,
};