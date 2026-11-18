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

// Capital & Compute: the table headed "Kit", "Price", "Per GB", shop prices
// by capacity. A cell is one price or a range, "$429 to $600". The table
// prints no date.
export function kitSizes(html, url) {
  const table = tables(html).find((t) => t.head[0] === "Kit" && t.head[1] === "Price" && t.head[2] === "Per GB");
  if (!table || table.rows.length < 2) throw new Error("The kit capacity table was not found");
  const range = (cell) => {
    const parts = cell.split(" to ").map(dollars);
    return parts.length <= 2 && parts.every((n) => n != null) ? [parts[0], parts[parts.length - 1]] : null;
  };
  return table.rows.map((cells) => {
    const name = cells[0].match(/^(\d+)GB (DDR\d) \(.+\)$/), price = range(cells[1]), per = range(cells[2]);
    if (!name || !price || !per) throw new Error(`Unreadable kit capacity row: ${cells.join(" | ")}`);
    return {
      kit: cells[0], capacity_gb: Number(name[1]), type: name[2],
      price_low: price[0], price_high: price[1], per_gb_low: per[0], per_gb_high: per[1],
      source_name: "Capital & Compute, retail prices by capacity", source_url: url,
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

// The spot board items the page follows, by the name TrendForce prints today,
// with the board each is on.
export const BOARD_ITEMS = {
  "DDR5 16Gb (2Gx8) 4800/5600": "DRAM spot", "DDR5 16Gb (2Gx8) eTT": "DRAM spot", "DDR4 16Gb (2Gx8) 3200": "DRAM spot",
  "DDR4 16Gb (2Gx8) eTT": "DRAM spot", "DDR4 8Gb (1Gx8) 3200": "DRAM spot", "DDR4 8Gb (1Gx8) eTT": "DRAM spot",
  "DDR3 4Gb 512Mx8 1600/1866": "DRAM spot", "DDR5 UDIMM 16GB 4800/5600": "Module spot", "DDR4 UDIMM 16GB 3200": "Module spot",
  "GDDR6 8Gb": "GDDR spot", "512Gb TLC": "NAND wafer spot",
};
// Names the board printed for the same items in earlier years.
export const BOARD_ALIASES = {
  "DDR5 16G (2Gx8) 4800/5600": "DDR5 16Gb (2Gx8) 4800/5600",
  "DDR5 16G (2Gx8) eTT": "DDR5 16Gb (2Gx8) eTT",
  "DDR4 16Gb (2Gx8)3200": "DDR4 16Gb (2Gx8) 3200",
};
// A copy without one of these is not the board, so it is refused whole.
const BOARD_CORE = ["DDR5 16Gb (2Gx8) 4800/5600", "DDR4 8Gb (1Gx8) 3200", "512Gb TLC", "GDDR6 8Gb"];

// One live board row as a dated reading in the history.
export const boardReading = (row) => ({
  series: row.item, item: row.item, board: row.board, date: row.as_of, price: row.session_avg,
  source_name: row.source_name, source_url: row.source_url,
});

// The DRAMeXchange home page as the Internet Archive kept it: the same spot
// board, with each table under its own "Last Update: Jul.1 2025" line. Every
// reading takes the date of its own table, never the date of the copy.
// `stamp` is the archive's 14-digit time for the copy.
export function boardArchive(html, url, stamp) {
  const taken = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
  const rows = [];
  let seen = null;
  for (const table of tables(html)) {
    const priced = table.rows.filter((cells) => BOARD_ITEMS[BOARD_ALIASES[cells[0]] || cells[0]]);
    if (!priced.length) {
      const stamped = [table.head, ...table.rows].flat().join(" ").match(/Last Update:?\s*([A-Z][a-z]{2})\.\s?(\d{1,2}) (\d{4})/);
      if (stamped && MONTHS[stamped[1]]) seen = `${stamped[3]}-${two(MONTHS[stamped[1]])}-${two(stamped[2])}`;
      continue;
    }
    const column = table.head.indexOf("Session Average");
    for (const cells of priced) {
      const series = BOARD_ALIASES[cells[0]] || cells[0];
      const price = column < 0 ? null : dollars(cells[column]);
      if (price == null || !seen) throw new Error(`Archived board row ${cells[0]} has no price or no Last Update date`);
      const days = (Date.parse(taken) - Date.parse(seen)) / 864e5;
      if (days < -1 || days > 45) throw new Error(`Archived board row ${cells[0]} is dated ${seen} in a copy taken ${taken}`);
      rows.push({
        series, item: cells[0], board: BOARD_ITEMS[series], date: seen, price,
        source_name: "DRAMeXchange spot board, Internet Archive copy", source_url: url, captured: stamp,
      });
    }
  }
  const missing = BOARD_CORE.filter((item) => !rows.some((row) => row.series === item));
  if (missing.length) throw new Error(`Not on the archived board: ${missing.join(", ")}`);
  return rows;
}

// Tom's Hardware GPU price tracker: every table headed "GPU Model",
// "Best US Price", "Lowest-Ever U.S. Price", "MSRP Launch Price". The tables
// carry no date, and the prices change only when the article does (two
// archived copies with the same modified time hold the same prices), so a
// reading is dated by the article's modified time, or its published time on
// the day it first appeared. `stamp` marks an Internet Archive copy.
const CURRENT_CARDS = /^(GeForce RTX 50\d\d|Radeon RX 90\d\d|Intel Arc B\d)/;
export function gpuTracker(html, url, stamp = null) {
  const found = tables(html).filter((t) => t.head[0] === "GPU Model" && t.head[1] === "Best US Price" && t.head[3] === "MSRP Launch Price");
  if (!found.length) throw new Error("The graphics card price tables were not found");
  const stated = (name) => (html.match(new RegExp(`<meta[^>]+property="article:${name}"[^>]+content="(\\d{4}-\\d{2}-\\d{2})T`)) || [])[1];
  const date = stated("modified_time") || stated("published_time");
  if (!date) throw new Error("The graphics card page does not say when it was last changed");
  if (stamp && date > `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`) throw new Error(`The graphics card page is dated ${date}, after the copy was taken`);
  const rows = found.flatMap((table) => table.rows.map((cells) => {
    const msrp = dollars(cells[3]), price = dollars(cells[1]), lowest = dollars(cells[2]);
    if (!cells[0] || msrp == null || lowest == null || (price == null && cells[1] !== "Out of Stock")) throw new Error(`Unreadable graphics card row: ${cells.join(" | ")}`);
    const row = {
      series: cells[0], card: cells[0],
      brand: /^GeForce/.test(cells[0]) ? "NVIDIA" : /^Radeon/.test(cells[0]) ? "AMD" : /^Intel/.test(cells[0]) ? "Intel" : "",
      current: CURRENT_CARDS.test(cells[0]),
      msrp, price, lowest_ever: lowest, date,
      source_name: stamp ? "Tom's Hardware GPU price tracker, Internet Archive copy" : "Tom's Hardware GPU price tracker",
      source_url: url,
    };
    if (stamp) row.captured = stamp;
    return row;
  }));
  if (rows.filter((row) => row.current).length < 8) throw new Error("Fewer than 8 current-generation cards were found");
  return rows;
}

// Two sets of dated readings as one, a row per series and date. A reading
// read live replaces an archived one for the same day, and of two archived
// copies the later one stands. Sorted by date, then series.
export function unionReadings(have, add) {
  const rank = (row) => (row.captured ? "0" + row.captured : "1");
  const kept = new Map();
  for (const row of [...have, ...add]) {
    const key = row.series + "|" + row.date;
    const old = kept.get(key);
    if (!old || rank(row) >= rank(old)) kept.set(key, row);
  }
  return [...kept.values()].sort((a, b) => byDate(a, b) || (a.series < b.series ? -1 : a.series > b.series ? 1 : 0));
}
