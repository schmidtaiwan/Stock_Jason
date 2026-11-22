import { readFile, writeFile } from "node:fs/promises";

const sources = [
  "https://isin.twse.com.tw/isin/C_public.jsp?strMode=2",
  "https://isin.twse.com.tw/isin/C_public.jsp?strMode=4",
  "https://www.tsit.com.tw/ETF/Home/ETFSeriesDetail/00962"
];
const localFiles = process.argv.slice(2);
if (localFiles.length && localFiles.length !== sources.length) {
  throw new Error("Provide all three source files: listed ISIN, OTC ISIN, and 00962 portfolio.");
}
const pages = await Promise.all(sources.map(async (url, index) => {
  let bytes;
  if (localFiles.length) {
    bytes = await readFile(localFiles[index]);
  } else {
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error(url + " returned " + response.status);
    bytes = await response.arrayBuffer();
  }
  return new TextDecoder(index < 2 ? "big5" : "utf-8").decode(bytes);
}));

function parseIsin(html, market, includeStocks) {
  const date = html.match(/最近更新日期:\s*(\d{4}\/\d{2}\/\d{2})/)?.[1]?.replaceAll("/", "-");
  const rows = [];
  let section = "";
  for (const [, row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Array.from(row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), function (cell) {
      return cell[1].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();
    });
    if (cells.length === 1) section = cells[0];
    if (cells.length !== 7 || cells[3] !== market) continue;
    const isEtf = section === "ETF";
    if (!isEtf && !(includeStocks && ["股票", "特別股", "創新板"].includes(section))) continue;
    const security = cells[0].match(/^([\dA-Z]+)\s+(.+)$/);
    if (!security) throw new Error("Unexpected security entry: " + cells[0]);
    const [, code, name] = security;
    const category = isEtf
      ? (/^\d{5}[AD]$/.test(code) ? "主動 ETF" : "被動 ETF")
      : cells[4] || "未分類";
    rows.push([code, name, market, isEtf ? "ETF" : section, category]);
  }
  if (!date || !rows.some((row) => row[3] === "ETF") || (includeStocks && rows.length < 1000)) {
    throw new Error("Incomplete ISIN directory for " + market);
  }
  return { date, rows };
}

const listed = parseIsin(pages[0], "上市", true);
const otc = parseIsin(pages[1], "上櫃", false);
const aiDate = pages[2].match(/id="DATA_DATE"[^>]+value="(\d{4}\/\d{2}\/\d{2})/)?.[1]?.replaceAll("/", "-");
const aiCodes = new Set(Array.from(pages[2].matchAll(/<td>\s*(\d{4}) TT\s*<\/td>/g), (row) => row[1]));
const rows = listed.rows.concat(otc.rows).sort((a, b) => a[0].localeCompare(b[0]));
const ai = rows.filter((row) => row[3] !== "ETF" && aiCodes.has(row[0])).map((row) => row[0]);
if (!aiDate || ai.length < 10 || new Set(rows.map((row) => row[0])).size !== rows.length) {
  throw new Error("Incomplete AI portfolio or duplicate securities.");
}
const metadata = { listedDate: listed.date, otcDate: otc.date, aiDate, ai };
const output = JSON.stringify(metadata).slice(0, -1) + ',\n"rows":[\n' +
  rows.map((row) => JSON.stringify(row)).join(",\n") + "\n]}\n";
await writeFile(new URL("../data/stock-directory.json", import.meta.url), output);
console.log("Saved " + rows.length + " securities, including " + ai.length + " AI concept stocks.");
