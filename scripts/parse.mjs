// Pure parsers: page HTML in, rows out. Each one throws when its table is
// missing or a cell is unreadable, so a changed page is never read as empty
// or wrong data.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export const text = (html) => html
  .replace(/<[^>]*>/g, " ")
  .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
    if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? whole;
    const hex = name[1].toLowerCase() === "x";
    return String.fromCodePoint(parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10));
  })
  .replace(/\s+/g, " ")
  .trim();

// Every table on a page: its heading row, its body rows, and the date of the
// last "Last Update" line that stands between it and the table before.
export function tables(html) {
  const found = [];
  let from = 0;
  for (const match of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const stamps = [...html.slice(from, match.index).matchAll(/Last Update\s+(\d{4}-\d{2}-\d{2})/g)];
    const rows = [...match[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
      .map((row) => [...row[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => text(cell[1])))
      .filter((cells) => cells.length);
    found.push({ head: rows[0] || [], rows: rows.slice(1), asOf: stamps.length ? stamps.at(-1)[1] : null });
    from = match.index + match[0].length;
  }
  return found;
}

const number = (cell) => {
  const found = String(cell).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return found ? Number(found[0]) : null;
};
const dollars = (cell) => {
  const plain = String(cell).replace(/[$,]/g, "");
  return /^\d+(\.\d+)?$/.test(plain) ? Number(plain) : null;
};
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

// TrendForce spot boards. `want` maps an item name, exactly as printed, to
// the board label shown on the page.
export function trendforce(html, want, url) {
  const rows = [];
  for (const table of tables(html)) {
    const column = (...names) => table.head.findIndex((name) => names.includes(name));
    for (const cells of table.rows) {
      if (!want[cells[0]]) continue;
      const change = cells[column("Session Change", "Average Change")];
      const row = {
        item: cells[0],
        board: want[cells[0]],
        session_avg: number(cells[column("Session Average")]),
        change_pct: number(change),
        low: number(cells[column("Daily Low", "Weekly Low")]),
        high: number(cells[column("Daily High", "Weekly High")]),
        as_of: table.asOf,
        source_name: "TrendForce",
        source_url: url,
      };
      if (row.change_pct > 0 && /▼/.test(change)) row.change_pct = -row.change_pct;
      if ([row.session_avg, row.change_pct, row.low, row.high, row.as_of].some((value) => value == null)) {
        throw new Error(`TrendForce row ${cells[0]} is missing a column or its Last Update date`);
      }
      rows.push(row);
    }
  }
  const missing = Object.keys(want).filter((item) => !rows.some((row) => row.item === item));
  if (missing.length) throw new Error(`Not found on ${url}: ${missing.join(", ")}`);
  return rows;
}

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const two = (n) => String(n).padStart(2, "0");

// Capital & Compute: the table headed "Reading date" and "Spot price".
export function ddr4History(html, url) {
  const table = tables(html).find((t) => t.head[0] === "Reading date" && t.head[1] === "Spot price");
  if (!table || table.rows.length < 2) throw new Error("The DDR4 readings table was not found");
  return table.rows.map((cells) => {
    const date = cells[0].match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
    const price = dollars(cells[1]);
    if (!date || !MONTHS[date[1]] || price == null) throw new Error(`Unreadable DDR4 reading: ${cells.join(" | ")}`);
    return {
      date: `${date[3]}-${two(MONTHS[date[1]])}-${two(date[2])}`,
      price,
      item: "DDR4 1Gx8 3200 spot",
      source_name: "Capital & Compute, from TrendForce and DRAMeXchange readings",
      source_url: url,
    };
  }).sort(byDate);
}

// Capital & Compute: the table headed "Date", "Cheapest tracked", "Average listing".
export function kitRetail(html, url) {
  const table = tables(html).find((t) => t.head[0] === "Date" && t.head[1] === "Cheapest tracked" && t.head[2] === "Average listing");
  if (!table || table.rows.length < 2) throw new Error("The kit price table was not found");
  return table.rows.map((cells) => {
    const cheapest = dollars(cells[1]), average = dollars(cells[2]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0]) || cheapest == null || average == null) throw new Error(`Unreadable kit price row: ${cells.join(" | ")}`);
    return {
      date: cells[0], cheapest, average,
      item: "2x16GB DDR5-6000 CL30 kit",
      source_name: "Capital & Compute, aggregated from WhereIsMyRAM",
      source_url: url,
    };
  }).sort(byDate);
}

// ComputingForGeeks: the current-generation table. Its date is in a column
// heading with no year, read as the latest such day that is not after `today`.
export function gpuStreet(html, url, today = new Date()) {
  const table = tables(html).find((t) => t.head[0] === "Card" && t.head.includes("MSRP") && t.head.includes("Great price") && t.head.some((h) => /^Lowest new, /.test(h)));
  if (!table || !table.rows.length) throw new Error("The current-generation price table was not found");
  const col = table.head.findIndex((h) => /^Lowest new, /.test(h));
  const stamp = table.head[col].match(/^Lowest new, ([A-Z][a-z]{2})[a-z]* (\d{1,2})$/);
  if (!stamp || !MONTHS[stamp[1]]) throw new Error(`Unreadable date in the heading: ${table.head[col]}`);
  let day = new Date(Date.UTC(today.getUTCFullYear(), MONTHS[stamp[1]] - 1, Number(stamp[2])));
  if (day - today > 864e5) day = new Date(Date.UTC(today.getUTCFullYear() - 1, MONTHS[stamp[1]] - 1, Number(stamp[2])));
  const observed = day.toISOString().slice(0, 10);
  return table.rows.map((cells) => {
    const msrp = dollars(cells[table.head.indexOf("MSRP")]);
    const priced = cells[col].match(/^(\$[\d,.]+) \(([+-]?\d+(\.\d+)?)%, (.+)\)$/);
    if (msrp == null || (!priced && cells[col] !== "No new stock")) throw new Error(`Unreadable graphics card row: ${cells.slice(0, col + 1).join(" | ")}`);
    return {
      card: cells[0],
      brand: /^RTX/.test(cells[0]) ? "NVIDIA" : /^RX/.test(cells[0]) ? "AMD" : /^Arc/.test(cells[0]) ? "Intel" : "",
      vram: cells[table.head.indexOf("VRAM")],
      msrp,
      street: priced ? dollars(priced[1]) : null,
      premium_pct: priced ? Number(priced[2]) : null,
      seller: priced ? priced[4] : "No new stock",
      observed,
      source_name: "ComputingForGeeks, from the Amazon product API, US store",
      source_url: url,
    };
  });
}

// TechFuelHQ: the table of published index rows.
export function gpuIndex(html, url) {
  const table = tables(html).find((t) => t.head[0] === "UTC date" && /^Median premium/.test(t.head[2] || ""));
  if (!table || table.rows.length < 2) throw new Error("The index table was not found");
  return table.rows.map((cells) => {
    const pair = cells[1].match(/^(\d+) \/ (\d+)$/), pct = cells[2].match(/^([+-]?\d+(\.\d+)?)%$/);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0]) || !pair || !pct) throw new Error(`Unreadable index row: ${cells.join(" | ")}`);
    return {
      date: cells[0],
      median_premium_pct: Number(pct[1]),
      cards_qualified: Number(pair[1]),
      cards_tracked: Number(pair[2]),
      source_name: "TechFuelHQ GPU Price Index, Newegg pilot (CC BY 4.0)",
      source_url: url,
    };
  }).sort(byDate);
}

// A dated series keeps every reading it has: a new one replaces the row with
// the same date, is added when it is newer than the last, and is dropped
// when it is older.
export function withReading(series, reading) {
  const last = series.at(-1);
  if (!last || reading.date > last.date) return [...series, reading];
  if (reading.date === last.date) return [...series.slice(0, -1), reading];
  return series;
}
