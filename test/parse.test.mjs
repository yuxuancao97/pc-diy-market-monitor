// The parsers against the tables of each source page as read on 2026-11-17,
// and the shape of the data the page draws from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tables, text, trendforce, ddr4History, kitRetail, gpuStreet, gpuIndex, withReading } from "../scripts/parse.mjs";

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

test("DDR4 readings are dated and sorted", () => {
  const rows = ddr4History(fixture("ddr4_spot_history"), "u");
  assert.equal(rows.length, 25);
  assert.deepEqual([rows[0].date, rows[0].price], ["2025-11-12", 12.18]);
  assert.deepEqual([rows.at(-1).date, rows.at(-1).price], ["2026-11-16", 44.36]);
});

test("the same DDR4 readings are read from the memory prices page", () => {
  const rows = ddr4History(fixture("ddr5_kit_retail"), "u");
  assert.deepEqual(rows, ddr4History(fixture("ddr4_spot_history"), "u"));
});

test("kit prices carry cheapest and average", () => {
  const rows = kitRetail(fixture("ddr5_kit_retail"), "u");
  assert.equal(rows.length, 16);
  assert.deepEqual([rows.at(-1).date, rows.at(-1).cheapest, rows.at(-1).average], ["2026-11-16", 429, 622]);
});

test("graphics cards keep names, sellers and missing stock exactly", () => {
  const rows = gpuStreet(fixture("gpu_street"), "u", new Date("2026-11-17T00:00:00Z"));
  assert.equal(rows.length, 15);
  const card = (name) => rows.find((r) => r.card === name);
  assert.deepEqual([card("RTX 5060 Ti 16GB").msrp, card("RTX 5060 Ti 16GB").street, card("RTX 5060 Ti 16GB").premium_pct], [429, 829.99, 93.5]);
  assert.equal(card("RTX 5080").seller, "Amazon Germany (import)");
  assert.deepEqual([card("Arc B580").street, card("Arc B580").premium_pct, card("Arc B580").seller, card("Arc B580").brand], [null, null, "No new stock", "Intel"]);
  assert.equal(rows[0].observed, "2026-11-11");
});

test("a heading date later in the year than today belongs to last year", () => {
  const rows = gpuStreet(fixture("gpu_street"), "u", new Date("2027-01-05T00:00:00Z"));
  assert.equal(rows[0].observed, "2026-11-11");
});

test("the Newegg index rows are read with their card counts", () => {
  const rows = gpuIndex(fixture("gpu_index"), "u");
  assert.equal(rows.length, 14);
  assert.deepEqual([rows.at(-1).date, rows.at(-1).median_premium_pct, rows.at(-1).cards_qualified, rows.at(-1).cards_tracked], ["2026-10-11", 57.5, 7, 8]);
});

test("every parser refuses a page without its table", () => {
  assert.throws(() => ddr4History(EMPTY, "u"));
  assert.throws(() => kitRetail(EMPTY, "u"));
  assert.throws(() => gpuStreet(EMPTY, "u"));
  assert.throws(() => gpuIndex(EMPTY, "u"));
  assert.throws(() => trendforce(EMPTY, { "512Gb TLC": "NAND wafer spot" }, "u"));
});

test("a dated series only ever grows forward", () => {
  const series = [{ date: "2026-11-03", price: 1 }, { date: "2026-11-05", price: 2 }];
  assert.equal(withReading(series, { date: "2026-11-06", price: 3 }).length, 3);
  assert.deepEqual(withReading(series, { date: "2026-11-05", price: 9 }).at(-1), { date: "2026-11-05", price: 9 });
  assert.deepEqual(withReading(series, { date: "2026-11-01", price: 9 }), series);
  assert.deepEqual(withReading([], { date: "2026-11-01", price: 9 }), [{ date: "2026-11-01", price: 9 }]);
});

test("the data files hold the columns the page reads", () => {
  const data = (id) => JSON.parse(readFileSync(here(`../site/data/${id}.json`), "utf8"));
  const columns = {
    dram_spot: ["item", "board", "session_avg", "change_pct", "low", "high", "as_of"],
    nand_wafer_board: ["item", "session_avg", "change_pct", "as_of"],
    ddr4_spot_history: ["date", "price"],
    ddr5_spot_points: ["date", "price"],
    ddr5_kit_retail: ["date", "cheapest", "average"],
    nand_wafer_spot: ["date", "price", "weekly_change_pct"],
    trendforce_outlook: ["metric", "kind", "period", "low_pct", "high_pct", "range_text", "published"],
    gpu_street: ["card", "brand", "vram", "msrp", "street", "premium_pct", "seller", "observed"],
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
  assert.ok(data("meta").generated_at);
});

test("the page names its build on every file it loads, and the publish run fills it in", () => {
  const page = readFileSync(here("../site/index.html"), "utf8");
  for (const file of ["look.css", "app.css", "runtime.js", "app.js"]) assert.ok(page.includes(`${file}?v=__BUILD__`), `${file} carries the build name`);
  assert.ok(page.includes('<meta name="build" content="__BUILD__">'));
  const run = readFileSync(here("../.github/workflows/refresh.yml"), "utf8");
  assert.ok(run.includes("s/__BUILD__/") && run.includes("site/build.json"));
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
