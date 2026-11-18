// The parsers against the tables of each source page as read on 2026-11-17,
// and the shape of the data the page draws from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tables, text, trendforce, kitRetail, gpuTracker, gpuIndex, boardArchive, boardReading, unionReadings, BOARD_ITEMS } from "../scripts/parse.mjs";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const fixture = (id) => readFileSync(here(`fixtures/${id}.html`), "utf8");
const EMPTY = "<html><body><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>";

test("text decodes entities and drops tags", () => {
  assert.equal(text('<span class="x"><span>&#9660;</span> -0.32&nbsp;%</span>'), "▼ -0.32 %");
  assert.equal(text("Capital &amp; Compute"), "Capital & Compute");
});

test("tables carry the Last Update date that stands before them", () => {
  const found = tables(fixture("dram_spot"));
  assert.equal(found[0].head[0], "Item");
  assert.equal(found[0].asOf, "2026-11-17");
  assert.equal(found[1].asOf, "2026-09-30");
});

test("TrendForce DRAM page gives each wanted row with its own date", () => {
  const want = { "DDR5 16Gb (2Gx8) 4800/5600": "DRAM spot", "DDR4 16Gb (2Gx8) 3200": "DRAM spot", "DDR5 UDIMM 16GB 4800/5600": "Module spot", "GDDR6 8Gb": "GDDR spot" };
  const rows = trendforce(fixture("dram_spot"), want, "u");
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { item: "DDR5 16Gb (2Gx8) 4800/5600", board: "DRAM spot", session_avg: 60.333, change_pct: 0, low: 45.3, high: 72, as_of: "2026-11-17", source_name: "TrendForce", source_url: "u" });
  assert.equal(rows[1].change_pct, -0.32);
  assert.equal(rows[2].as_of, "2026-11-09");
  assert.equal(rows[3].session_avg, 12.538);
});

test("TrendForce flash page gives the 512Gb TLC wafer row", () => {
  const [row] = trendforce(fixture("nand_wafer_board"), { "512Gb TLC": "NAND wafer spot" }, "u");
  assert.equal(row.session_avg, 14.267);
  assert.equal(row.change_pct, -11.67);
  assert.equal(row.as_of, "2026-11-09");
});

test("a TrendForce item that is not on the page is an error, not a gap", () => {
  assert.throws(() => trendforce(fixture("dram_spot"), { "DDR6 32Gb": "DRAM spot" }, "u"), /Not found/);
});

test("kit prices carry cheapest and average", () => {
  const rows = kitRetail(fixture("ddr5_kit_retail"), "u");
  assert.equal(rows.length, 16);
  assert.deepEqual([rows.at(-1).date, rows.at(-1).cheapest, rows.at(-1).average], ["2026-11-16", 429, 622]);
});

test("the card tracker keeps names, prices and missing stock exactly", () => {
  const rows = gpuTracker(fixture("gpu_cards"), "u");
  assert.equal(rows.length, 36);
  const card = (name) => rows.find((r) => r.card === name);
  assert.deepEqual([card("GeForce RTX 5090").price, card("GeForce RTX 5090").msrp, card("GeForce RTX 5090").lowest_ever], [6549, 1999, 1999]);
  assert.deepEqual([card("Radeon RX 7900 XTX").price, card("Radeon RX 7900 XTX").msrp], [null, 999]);
  assert.deepEqual([card("Intel Arc B580").brand, card("Intel Arc B580").current, card("Intel Arc A380").current, card("GeForce RTX 4090").current], ["Intel", true, false, false]);
  assert.equal(rows.filter((r) => r.current).length, 15);
});

test("the card tracker is dated by the article's own modified time, live or archived", () => {
  const live = gpuTracker(fixture("gpu_cards"), "u");
  assert.equal(live[0].date, "2026-11-17");
  assert.equal("captured" in live[0], false);
  const copy = gpuTracker(fixture("gpu_cards"), "u", "20261120203938");
  assert.deepEqual([copy[0].date, copy[0].captured], ["2026-11-17", "20261120203938"]);
  assert.equal(gpuTracker(fixture("gpu_cards").replace("article:modified_time", "article:published_time"), "u")[0].date, "2026-11-17", "a page not yet modified is dated by its publication");
  assert.throws(() => gpuTracker(fixture("gpu_cards"), "u", "20260123203938"), /after the copy was taken/);
  assert.throws(() => gpuTracker(fixture("gpu_cards").replace(/<meta[^>]*>/, ""), "u"), /last changed/);
});

test("an archived board dates each reading by its own table and keeps the name as printed", () => {
  const rows = boardArchive(fixture("board_archive"), "u", "20250701190105");
  const of = (series) => rows.find((r) => r.series === series);
  assert.deepEqual([of("DDR5 16Gb (2Gx8) 4800/5600").item, of("DDR5 16Gb (2Gx8) 4800/5600").date, of("DDR5 16Gb (2Gx8) 4800/5600").price], ["DDR5 16G (2Gx8) 4800/5600", "2025-07-01", 6.078]);
  assert.deepEqual([of("512Gb TLC").date, of("512Gb TLC").price, of("512Gb TLC").board], ["2025-06-23", 2.683, "NAND wafer spot"]);
  assert.deepEqual([of("GDDR6 8Gb").date, of("GDDR6 8Gb").price], ["2025-06-23", 2.443]);
  assert.ok(rows.every((r) => r.captured === "20250701190105" && BOARD_ITEMS[r.series]));
});

test("an archived board is refused when a date does not fit the copy or a core item is gone", () => {
  assert.throws(() => boardArchive(fixture("board_archive"), "u", "20260701190105"), /dated/);
  assert.throws(() => boardArchive(fixture("board_archive").replaceAll("512Gb TLC", "513Gb TLC"), "u", "20250701190105"), /Not on the archived board/);
  assert.throws(() => boardArchive(EMPTY, "u", "20250701190105"));
});

test("the Newegg index rows are read with their card counts", () => {
  const rows = gpuIndex(fixture("gpu_index"), "u");
  assert.equal(rows.length, 14);
  assert.deepEqual([rows.at(-1).date, rows.at(-1).median_premium_pct, rows.at(-1).cards_qualified, rows.at(-1).cards_tracked], ["2026-10-11", 57.5, 7, 8]);
});

test("every parser refuses a page without its table", () => {
  assert.throws(() => kitRetail(EMPTY, "u"));
  assert.throws(() => gpuTracker(EMPTY, "u"));
  assert.throws(() => gpuIndex(EMPTY, "u"));
  assert.throws(() => trendforce(EMPTY, { "512Gb TLC": "NAND wafer spot" }, "u"));
});

test("readings are joined a row per series and day: live beats archived, a later copy beats an earlier one", () => {
  const early = { series: "a", date: "2026-11-03", price: 1, captured: "20261103010000" };
  const late = { series: "a", date: "2026-11-03", price: 2, captured: "20261103230000" };
  const live = { series: "a", date: "2026-11-03", price: 3 };
  const other = { series: "b", date: "2026-11-01", price: 9 };
  assert.deepEqual(unionReadings([late], [early]), [late]);
  assert.deepEqual(unionReadings([early], [late]), [late]);
  assert.deepEqual(unionReadings([live], [late]), [live]);
  assert.deepEqual(unionReadings([late, other], [live]), [other, live]);
  assert.deepEqual(unionReadings([live], [{ ...live, price: 4 }])[0].price, 4);
});

test("a live board row becomes a reading under the name TrendForce prints", () => {
  const [row] = trendforce(fixture("nand_wafer_board"), { "512Gb TLC": "NAND wafer spot" }, "u");
  assert.deepEqual(boardReading(row), { series: "512Gb TLC", item: "512Gb TLC", board: "NAND wafer spot", date: "2026-11-09", price: 14.267, source_name: "TrendForce", source_url: "u" });
});

const fetchInto = (dir, from) => spawnSync(process.execPath, [here("../scripts/fetch.mjs"), "--from", from], { env: { ...process.env, MM_DATA: dir }, encoding: "utf8" });
const archive = [{ series: "512Gb TLC", item: "512Gb TLC", board: "NAND wafer spot", date: "2025-06-23", price: 2.683, source_name: "copy", source_url: "https://web.archive.org/web/20250701190105/https://www.dramexchange.com/", captured: "20250701190105" }];

test("a run adds today's readings to the archive and to what earlier runs kept", () => {
  const dir = mkdtempSync(join(tmpdir(), "mm-"));
  writeFileSync(join(dir, "spot_archive.json"), JSON.stringify(archive));
  writeFileSync(join(dir, "gpu_street.json"), "[]");
  const run = fetchInto(dir, here("fixtures"));
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const spot = JSON.parse(readFileSync(join(dir, "spot_history.json"), "utf8"));
  assert.deepEqual(spot[0], archive[0]);
  assert.deepEqual(spot.filter((r) => r.series === "512Gb TLC").map((r) => [r.date, r.price]), [["2025-06-23", 2.683], ["2026-11-09", 14.267]]);
  assert.equal(spot.filter((r) => r.date === "2026-11-17").length, 7);
  const cards = JSON.parse(readFileSync(join(dir, "gpu_history.json"), "utf8"));
  assert.equal(cards.length, 36);
  assert.equal(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")).sources.filter((s) => s.ok).length, 5);
  assert.equal(existsSync(join(dir, "gpu_street.json")), false, "a retired file is removed");
  assert.equal(existsSync(join(dir, "gpu_cards.json")), false, "the card page is kept only as history");
});

test("a run that reads nothing still writes the histories from the archive", () => {
  const dir = mkdtempSync(join(tmpdir(), "mm-"));
  writeFileSync(join(dir, "spot_archive.json"), JSON.stringify(archive));
  const run = fetchInto(dir, join(dir, "nothing-here"));
  assert.equal(run.status, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "spot_history.json"), "utf8")), archive);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "gpu_history.json"), "utf8")), []);
});

test("the data files hold the columns the page reads", () => {
  const data = (id) => JSON.parse(readFileSync(here(`../site/data/${id}.json`), "utf8"));
  const columns = {
    dram_spot: ["item", "board", "session_avg", "change_pct", "low", "high", "as_of"],
    nand_wafer_board: ["item", "session_avg", "change_pct", "as_of"],
    spot_archive: ["series", "item", "board", "date", "price", "captured"],
    spot_history: ["series", "item", "board", "date", "price"],
    ddr5_kit_retail: ["date", "cheapest", "average"],
    trendforce_outlook: ["metric", "kind", "period", "low_pct", "high_pct", "range_text", "published"],
    gpu_archive: ["series", "card", "brand", "current", "msrp", "price", "lowest_ever", "date", "captured"],
    gpu_history: ["series", "card", "brand", "current", "msrp", "price", "lowest_ever", "date"],
    gpu_index: ["date", "median_premium_pct", "cards_qualified", "cards_tracked"],
  };
  for (const [id, names] of Object.entries(columns)) {
    const rows = data(id);
    assert.ok(rows.length > 0, `${id} has rows`);
    for (const row of rows) {
      for (const name of names) assert.ok(name in row, `${id} row has ${name}`);
      assert.ok(row.source_url.startsWith("https://"), `${id} row names its source`);
    }
  }
  for (const id of ["spot_history", "gpu_history"]) {
    const keys = data(id).map((r) => r.series + "|" + r.date);
    assert.equal(new Set(keys).size, keys.length, `${id} has one row per series and day`);
  }
  for (const item of ["DDR5 16Gb (2Gx8) 4800/5600", "DDR4 8Gb (1Gx8) 3200", "GDDR6 8Gb", "512Gb TLC"]) {
    const rows = data("spot_history").filter((r) => r.series === item);
    assert.ok(rows[0].date < "2025-02-01" && rows.length > 40, `${item} reaches back to January 2025`);
  }
  assert.ok(data("meta").generated_at);
});

test("the publish run never lets the data branch overwrite a file kept on main", () => {
  const run = readFileSync(here("../.github/workflows/refresh.yml"), "utf8");
  for (const file of ["trendforce_outlook.json", "spot_archive.json", "gpu_archive.json"]) assert.ok(run.includes(`--exclude=${file}`), `${file} is excluded from the restore`);
});

test("the page names its build on every file it loads, and the publish run fills it in", () => {
  const page = readFileSync(here("../site/index.html"), "utf8");
  for (const file of ["look.css", "app.css", "rules.js", "runtime.js", "app.js"]) assert.ok(page.includes(`${file}?v=__BUILD__`), `${file} carries the build name`);
  assert.ok(page.includes('<meta name="build" content="__BUILD__">'));
  const run = readFileSync(here("../.github/workflows/refresh.yml"), "utf8");
  assert.ok(run.includes("s/__BUILD__/") && run.includes("site/build.json"));
});

const rules = async () => { await import("../site/rules.js"); return globalThis.mmRules; };

test("a move under 1% is steady, and falling is the good direction for a builder", async () => {
  const { direction, meaning } = await rules();
  assert.deepEqual([-5.3, -1, -0.9, 0, 0.9, 1, 8.3].map(direction), ["Falling", "Falling", "Steady", "Steady", "Steady", "Rising", "Rising"]);
  assert.deepEqual([-5.3, -0.9, 0, 0.9, 8.3].map(meaning), ["good", "", "", "", "bad"]);
});

test("a period takes the reading nearest to that many days earlier, or none when it is too far off", async () => {
  const { back } = await rules();
  const dates = ["2025-11-01", "2026-10-05", "2026-10-20", "2026-11-02", "2026-11-09"];
  assert.equal(back(dates, "2026-11-09", 7, 3), "2026-11-02");
  assert.equal(back(dates, "2026-11-09", 30, 10), "2026-10-05");
  assert.equal(back(dates, "2026-11-09", 30, 4), null);
  assert.equal(back(dates, "2026-11-09", 91, 15), null);
  assert.equal(back(dates, "2026-11-09", 365, 31), "2025-11-01");
  assert.equal(back(["2026-11-05", "2026-11-09", "2026-11-12"], "2026-11-14", 7, 3), "2026-11-05", "of two equally near, the earlier");
  assert.equal(back(["2026-11-09"], "2026-11-09", 7, 3), null, "the latest reading is never its own comparison");
});

test("every key price gets the same four periods from its own readings", async () => {
  const { periods, PERIODS } = await rules();
  assert.deepEqual(PERIODS.map((p) => p.label), ["1 week", "1 month", "3 months", "1 year"]);
  const got = periods([{ date: "2025-11-10", value: 10 }, { date: "2026-10-12", value: 50 }, { date: "2026-11-03", value: 61.5 }, { date: "2026-11-10", value: 60 }]);
  assert.deepEqual([got.latest, got.latest_date], [60, "2026-11-10"]);
  assert.deepEqual(got.w1, { pct: -2.4, from_date: "2026-11-03", from_value: 61.5 });
  assert.deepEqual(got.m1, { pct: 20, from_date: "2026-10-12", from_value: 50 });
  assert.equal(got.m3, null);
  assert.deepEqual(got.y1, { pct: 500, from_date: "2025-11-10", from_value: 10 });
  assert.equal(periods([]), null);
});

test("a verdict says where the price stands against its reference and which way it moved this month", async () => {
  const { level, verdict } = await rules();
  assert.deepEqual([652, 100, 99.9, 25, 24.9, 5, 4.9, -4.9, -5, -25].map(level), ["Far above", "Far above", "Well above", "Well above", "Above", "Above", "Close to", "Close to", "Below", "Well below"]);
  assert.deepEqual(verdict(652, -1.9, "a year ago"), { level: "Far above a year ago", level_tone: "bad", move: "Falling this month", move_tone: "good" });
  assert.deepEqual(verdict(-30, 0.4, "launch prices"), { level: "Well below launch prices", level_tone: "good", move: "Steady this month", move_tone: "" });
  assert.deepEqual(verdict(null, null, "a year ago"), { level: null, level_tone: "", move: null, move_tone: "" });
});

test("graphics cards: the level is the median premium, a period the median of each card's own change", async () => {
  const { cardStats } = await rules();
  const row = (series, date, price, current = true, msrp = 100) => ({ series, date, price, msrp, current });
  const got = cardStats([
    row("A", "2026-10-10", 100), row("B", "2026-10-10", 200), row("C", "2026-10-10", 150), row("old", "2026-10-10", 900, false),
    row("A", "2026-11-10", 150), row("B", "2026-11-10", 220), row("C", "2026-11-10", null), row("D", "2026-11-10", 300), row("old", "2026-11-10", 999, false),
  ]);
  assert.deepEqual([got.latest, got.latest_date, got.cards], [120, "2026-11-10", 3]);
  assert.deepEqual(got.m1, { pct: 30, from_date: "2026-10-10", cards: 2 });
  assert.equal(got.w1, null);
  assert.equal(got.y1, null);
  assert.deepEqual(got.points, [{ date: "2026-10-10", value: 50, cards: 3 }, { date: "2026-11-10", value: 120, cards: 3 }]);
  assert.equal(cardStats([]), null);
});

test("the key prices table has a column for each period, named as the rules name them", async () => {
  const { PERIODS } = await rules();
  const page = readFileSync(here("../site/index.html"), "utf8");
  const head = page.slice(page.indexOf('<table class="mm-key">'), page.indexOf("</thead>", page.indexOf('<table class="mm-key">')));
  assert.deepEqual([...head.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]), ["Price", "Now", ...PERIODS.map((p) => p.label), "Past year"]);
});

test("nothing private or secret is in the files that get published", () => {
  const banned = [/lishuangs-mac/i, /100\.110\.\d+\.\d+/, /claude\.ai\/artifact/, /private\/tmp\/claude/, /@gmail\.com/, /api[_-]?key/i];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".claude") return [];
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(path) : [path];
  });
  for (const path of walk(here(".."))) {
    if (path.endsWith("parse.test.mjs")) continue;
    const body = readFileSync(path, "utf8");
    for (const pattern of banned) assert.ok(!pattern.test(body), `${path} matches ${pattern}`);
  }
});
