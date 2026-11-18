// Reads the source pages and rewrites site/data. A source that cannot be
// read keeps its last good file, and meta.json says so.
//   node scripts/fetch.mjs                 read the live pages
//   node scripts/fetch.mjs --from <dir>    read saved pages (<id>.html) instead
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { trendforce, kitRetail, gpuTracker, gpuIndex, boardReading, unionReadings, BOARD_ITEMS } from "./parse.mjs";

// MM_DATA points the run at another folder, for the tests.
const DATA = process.env.MM_DATA || fileURLToPath(new URL("../site/data/", import.meta.url));
const from = process.argv.includes("--from") ? process.argv[process.argv.indexOf("--from") + 1] : null;

const pick = (board) => Object.fromEntries(Object.entries(BOARD_ITEMS).filter(([, name]) => (name === "NAND wafer spot") === board));

// `keep: false` marks a page whose rows go only into a history file.
export const SOURCES = [
  { id: "dram_spot", title: "TrendForce DRAM, module and GDDR spot boards", url: "https://www.trendforce.com/price/dram/dram_spot", parse: (html, url) => trendforce(html, pick(false), url) },
  { id: "nand_wafer_board", title: "TrendForce NAND wafer spot board", url: "https://www.trendforce.com/price/flash/flash_spot", parse: (html, url) => trendforce(html, pick(true), url) },
  { id: "ddr5_kit_retail", title: "Capital & Compute 32GB DDR5 kit prices", url: "https://capitalandcompute.net/memory-prices/", parse: kitRetail },
  { id: "gpu_cards", title: "Tom's Hardware GPU price tracker", url: "https://www.tomshardware.com/pc-components/gpus/lowest-gpu-prices-tracking", parse: (html, url) => gpuTracker(html, url), keep: false },
  { id: "gpu_index", title: "TechFuelHQ GPU Price Index, CC BY 4.0", url: "https://techfuelhq.com/data/gpu-price-index/", parse: gpuIndex },
];
// Files from sources the page no longer reads. The data branch still holds
// them, so they are removed after it is restored.
const RETIRED = ["ddr4_spot_history", "ddr5_spot_points", "nand_wafer_spot", "gpu_street"];

const load = async (name, fallback) => {
  try { return JSON.parse(await readFile(join(DATA, name + ".json"), "utf8")); } catch { return fallback; }
};
const save = (name, value) => writeFile(join(DATA, name + ".json"), JSON.stringify(value, null, 1) + "\n");
// A long history is written a reading to a line.
const saveLines = (name, rows) => writeFile(join(DATA, name + ".json"), "[\n" + rows.map((row) => JSON.stringify(row)).join(",\n") + "\n]\n");

const read = new Map();
const page = (source) => {
  const key = from ? source.id : source.url;
  if (!read.has(key)) read.set(key, fetchPage(source));
  return read.get(key);
};
async function fetchPage(source) {
  if (from) return readFile(join(from, source.id + ".html"), "utf8");
  // A source sometimes refuses the first request from a new address and
  // answers the next one, so a failed read is tried again after a pause.
  let last;
  for (const wait of [0, 4_000, 12_000]) {
    if (wait) await new Promise((done) => setTimeout(done, wait));
    try {
      const response = await fetch(source.url, {
        headers: { "user-agent": "pc-diy-market-monitor (static dashboard, hourly read)", accept: "text/html" },
        signal: AbortSignal.timeout(40_000),
      });
      if (response.ok) return await response.text();
      last = new Error(`HTTP ${response.status}`);
    } catch (error) {
      last = error;
    }
  }
  throw last;
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
    if (source.keep !== false) await save(source.id, rows);
    status.push({ id: source.id, title: source.title, url: source.url, ok: true, read_at: now });
    console.log(`ok    ${source.id}: ${rows.length} rows`);
  } catch (error) {
    status.push({ id: source.id, title: source.title, url: source.url, ok: false, read_at: was.read_at || null, error: String(error.message || error).slice(0, 200) });
    console.log(`KEPT  ${source.id}: ${error.message || error}`);
  }
}

// The two histories are put together on every run, read or not: the archive
// file from main, what earlier runs added, and today's reading when there is
// one. A page that could not be read leaves its history as it was.
const live = [...(fresh.dram_spot || []), ...(fresh.nand_wafer_board || [])].map(boardReading);
await saveLines("spot_history", unionReadings(unionReadings(await load("spot_archive", []), await load("spot_history", [])), live));
await saveLines("gpu_history", unionReadings(unionReadings(await load("gpu_archive", []), await load("gpu_history", [])), fresh.gpu_cards || []));
for (const name of RETIRED) await rm(join(DATA, name + ".json"), { force: true });

await save("meta", { generated_at: now, sources: status });
const failed = status.filter((s) => !s.ok).length;
console.log(`${status.length - failed} of ${status.length} sources read`);
if (failed === status.length) process.exitCode = 1;
