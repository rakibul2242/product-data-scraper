import { google } from "googleapis";
import fs from "fs";
import config from "./config.js";

let sheetsClient = null;

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  if (!fs.existsSync(config.CREDENTIALS_PATH)) {
    throw new Error(
      `Credentials file not found at ${config.CREDENTIALS_PATH}. See README.md for setup steps.`
    );
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: config.CREDENTIALS_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const client = await auth.getClient();
  sheetsClient = google.sheets({ version: "v4", auth: client });
  return sheetsClient;
}

export async function readLinks() {
  const sheets = await getSheetsClient();
  const cols = config.COLUMNS;

  const range = `${config.SHEET_NAME}!${cols.sourceLink}${config.START_ROW}:${cols.description}`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.SPREADSHEET_ID,
    range,
  });

  const rows = res.data.values || [];
  return rows.map((row, i) => ({
    row: config.START_ROW + i,
    url: (row[0] || "").trim(),
    productName: row[1] || "",
  }));
}

export async function writeBatch(updates) {
  if (updates.length === 0) return;
  const sheets = await getSheetsClient();
  const cols = config.COLUMNS;

  // Maps config field names to internal data keys
  const fieldToDataKey = {
    productName: "name",
    price: "price",
    brand: "brand",
    category: "category",
    productType: "type",
    description: "description",
  };

  const configuredFields = config.FIELDS.filter((f) => fieldToDataKey[f]);
  if (configuredFields.length === 0) return;

  const firstCol = cols[configuredFields[0]];
  const lastCol = cols[configuredFields[configuredFields.length - 1]];

  const data = updates.map(({ row, data }) => ({
    range: `${config.SHEET_NAME}!${firstCol}${row}:${lastCol}${row}`,
    values: [configuredFields.map((f) => data[fieldToDataKey[f]] || "")],
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data,
    },
  });
}