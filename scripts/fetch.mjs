// Reads the source pages and rewrites site/data. A source that cannot be
// read keeps its last good file, and meta.json says so.
//   node scripts/fetch.mjs                 read the live pages
//   node scripts/fetch.mjs --from <dir>    read saved pages (<id>.html) instead
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { trendforce, ddr4History, kitRetail, gpuStreet, gpuIndex, withReading } from "./parse.mjs";

const DATA = fileURLToPath(new URL("../site/data/", import.meta.url));
const from = process.argv.includes("--from") ? process.argv[process.argv.indexOf("--from") + 1] : null;

const DRAM_ITEMS = {
  "DDR5 16Gb (2Gx8) 4800/5600": "DRAM spot", "DDR5 16Gb (2Gx8) eTT": "DRAM spot", "DDR4 16Gb (2Gx8) 3200": "DRAM spot",
  "DDR4 16Gb (2Gx8) eTT": "DRAM spot", "DDR4 8Gb (1Gx8) 3200": "DRAM spot", "DDR4 8Gb (1Gx8) eTT": "DRAM spot",
  "DDR3 4Gb 512Mx8 1600/1866": "DRAM spot", "DDR5 UDIMM 16GB 4800/5600": "Module spot", "DDR4 UDIMM 16GB 3200": "Module spot",
  "GDDR6 8Gb": "GDDR spot",
};

export const SOURCES = [
  { id: "dram_spot", title: "TrendForce DRAM, module and GDDR spot boards", url: "https://www.trendforce.com/price/dram/dram_spot", parse: (html, url) => trendforce(html, DRAM_ITEMS, url) },
  { id: "nand_wafer_board", title: "TrendForce NAND wafer spot board", url: "https://www.trendforce.com/price/flash/flash_spot", parse: (html, url) => trendforce(html, { "512Gb TLC": "NAND wafer spot" }, url) },
  // The history page refuses GitHub's servers, and the same readings are on the
  // memory prices page, which is read once for both series.
  { id: "ddr4_spot_history", title: "Capital & Compute DDR4 spot readings", url: "https://capitalandcompute.net/memory-prices/", parse: ddr4History },
  { id: "ddr5_kit_retail", title: "Capital & Compute 32GB DDR5 kit prices", url: "https://capitalandcompute.net/memory-prices/", parse: kitRetail },
  { id: "gpu_street", title: "ComputingForGeeks graphics card prices", url: "https://computingforgeeks.com/gpu-prices/", parse: gpuStreet },
  { id: "gpu_index", title: "TechFuelHQ GPU Price Index", url: "https://techfuelhq.com/data/gpu-price-index/", parse: gpuIndex },
];

const load = async (name, fallback) => {
  try { return JSON.parse(await readFile(join(DATA, name + ".json"), "utf8")); } catch { return fallback; }
};
const save = (name, value) => writeFile(join(DATA, name + ".json"), JSON.stringify(value, null, 1) + "\n");

const read = new Map();
const page = (source) => {
  const key = from ? source.id : source.url;
  if (!read.has(key)) read.set(key, fetchPage(source));
  return read.get(key);
};
async function fetchPage(source) {
  if (from) return readFile(join(from, source.id + ".html"), "utf8");
  const response = await fetch(source.url, {
    headers: { "user-agent": "pc-diy-market-monitor (static dashboard, hourly read)", accept: "text/html" },
    signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

const now = new Date().toISOString();
const before = await load("meta", { sources: [] });
const status = [];
const fresh = {};

for (const source of SOURCES) {
  const was = before.sources.find((s) => s.id === source.id) || {};
  try {
    const rows = source.parse(await page(source), source.url);
    fresh[source.id] = rows;
    await save(source.id, rows);
    status.push({ id: source.id, title: source.title, url: source.url, ok: true, read_at: now });
    console.log(`ok    ${source.id}: ${rows.length} rows`);
  } catch (error) {
    status.push({ id: source.id, title: source.title, url: source.url, ok: false, read_at: was.read_at || null, error: String(error.message || error).slice(0, 200) });
    console.log(`KEPT  ${source.id}: ${error.message || error}`);
  }
}

// Two dated series are built up here, because no page prints their history.
if (fresh.dram_spot) {
  const row = fresh.dram_spot.find((r) => r.item === "DDR5 16Gb (2Gx8) 4800/5600");
  const series = await load("ddr5_spot_points", []);
  await save("ddr5_spot_points", withReading(series, { date: row.as_of, price: row.session_avg, source_name: "TrendForce", source_url: row.source_url, item: "DDR5 16Gb (2Gx8) 4800/5600 spot" }));
}
if (fresh.nand_wafer_board) {
  const row = fresh.nand_wafer_board[0];
  const series = await load("nand_wafer_spot", []);
  await save("nand_wafer_spot", withReading(series, { date: row.as_of, price: row.session_avg, weekly_change_pct: row.change_pct, source_name: "TrendForce", source_url: row.source_url, item: "512Gb TLC wafer spot" }));
}

await save("meta", { generated_at: now, sources: status });
const failed = status.filter((s) => !s.ok).length;
console.log(`${status.length - failed} of ${status.length} sources read`);
if (failed === status.length) process.exitCode = 1;
