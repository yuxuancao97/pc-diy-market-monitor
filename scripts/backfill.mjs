// Builds the two archive files from copies of the source pages kept by the
// Internet Archive. Run by hand, not by the publish workflow.
//   node scripts/backfill.mjs            download what is missing, then parse
//   node scripts/backfill.mjs --parse    parse the saved copies only
// Copies are kept in BACKFILL_CACHE (default .cache/backfill, not in git) so
// a second run asks the archive for nothing it already has.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { boardArchive, gpuTracker, unionReadings } from "./parse.mjs";

const DATA = fileURLToPath(new URL("../site/data/", import.meta.url));
const CACHE = process.env.BACKFILL_CACHE || fileURLToPath(new URL("../.cache/backfill/", import.meta.url));
const AGENT = "pc-diy-market-monitor (static dashboard, one-time history read)";
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

export const PAGES = [
  { id: "board", file: "spot_archive", page: "https://www.dramexchange.com/", from: "20250101", parse: boardArchive },
  { id: "cards", file: "gpu_archive", page: "https://www.tomshardware.com/pc-components/gpus/lowest-gpu-prices-tracking", from: "20260101", parse: gpuTracker },
];
const copy = (target, stamp) => `https://web.archive.org/web/${stamp}/${target.page}`;

async function get(url) {
  let last;
  for (const wait of [0, 5_000, 20_000, 60_000]) {
    if (wait) await pause(wait);
    try {
      const response = await fetch(url, { headers: { "user-agent": AGENT }, signal: AbortSignal.timeout(90_000) });
      if (response.ok) return await response.text();
      last = new Error(`HTTP ${response.status}`);
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

// Every copy the archive holds, grouped by day, latest first within a day.
async function captures(target) {
  const list = await get(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target.page)}&output=txt&fl=timestamp&filter=statuscode:200&from=${target.from}`);
  const days = new Map();
  for (const stamp of list.split("\n").map((line) => line.trim()).filter((line) => /^\d{14}$/.test(line)).sort().reverse()) {
    if (!days.has(stamp.slice(0, 8))) days.set(stamp.slice(0, 8), []);
    days.get(stamp.slice(0, 8)).push(stamp);
  }
  return [...days.entries()].sort();
}

// For each day, the latest copy that the parser can read. A copy that cannot
// be read (the archive sometimes keeps a page without its tables) is kept on
// disk so it is not asked for again, and the copy before it is tried.
async function download() {
  for (const target of PAGES) {
    const dir = join(CACHE, target.id);
    await mkdir(dir, { recursive: true });
    const days = await captures(target);
    let got = 0, empty = 0;
    for (const [, stamps] of days) {
      let read = false;
      for (const stamp of stamps.slice(0, 4)) {
        const file = join(dir, stamp + ".html");
        try {
          if (!existsSync(file)) {
            await writeFile(file, await get(`https://web.archive.org/web/${stamp}id_/${target.page}`));
            got++;
            await pause(1_500);
          }
          target.parse(await readFile(file, "utf8"), copy(target, stamp), stamp);
          read = true;
          break;
        } catch (error) {
          console.log(`UNREAD ${target.id} ${stamp}: ${error.message || error}`);
        }
      }
      if (!read) empty++;
    }
    console.log(`${target.id}: ${days.length} days in the archive, ${got} copies downloaded now, ${empty} days with no readable copy`);
  }
}

// Reads every saved copy, latest first within a day, and keeps the first one
// per day that parses.
async function parse() {
  for (const target of PAGES) {
    const names = (await readdir(join(CACHE, target.id))).filter((name) => /^\d{14}\.html$/.test(name)).sort().reverse();
    const done = new Set();
    let rows = [], unread = 0;
    for (const name of names) {
      const stamp = name.slice(0, 14), day = stamp.slice(0, 8);
      if (done.has(day)) continue;
      try {
        rows = unionReadings(rows, target.parse(await readFile(join(CACHE, target.id, name), "utf8"), copy(target, stamp), stamp));
        done.add(day);
      } catch (error) {
        unread++;
        console.log(`UNREAD ${target.id} ${stamp}: ${error.message || error}`);
      }
    }
    await writeFile(join(DATA, target.file + ".json"), "[\n" + rows.map((row) => JSON.stringify(row)).join(",\n") + "\n]\n");
    console.log(`${target.file}: ${rows.length} readings from ${done.size} days, ${unread} copies unread`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes("--parse")) await download();
  if (!process.argv.includes("--download")) await parse();
}
