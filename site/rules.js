// Every judgement the page makes about a number is made here, and tested.
(function (root) {
  const DAY = 864e5;

  // A change of 1% or more is a move. Under that the price is steady.
  const direction = (pct) => (pct <= -1 ? "Falling" : pct >= 1 ? "Rising" : "Steady");
  // What a move means for someone building a PC: cheaper is good.
  const meaning = (pct) => (pct <= -1 ? "good" : pct >= 1 ? "bad" : "");

  // The same four periods on every row. A period compares the latest reading
  // with the one nearest to `days` earlier, and has no figure when no reading
  // lies within `within` days of that day.
  const PERIODS = [
    { id: "w1", label: "1 week", days: 7, within: 3 },
    { id: "m1", label: "1 month", days: 30, within: 10 },
    { id: "m3", label: "3 months", days: 91, within: 15 },
    { id: "y1", label: "1 year", days: 365, within: 31 },
  ];

  // `dates` are ISO days in any order. Returns the one nearest to `days`
  // before `latest`, or null. Of two equally near, the earlier one.
  function back(dates, latest, days, within) {
    const want = Date.parse(latest) - days * DAY;
    let best = null, off = Infinity;
    for (const date of dates) {
      if (date >= latest) continue;
      const miss = Math.abs(Date.parse(date) - want) / DAY;
      if (miss < off || (miss === off && date < best)) { best = date; off = miss; }
    }
    return off <= within ? best : null;
  }

  // Percent change to one decimal place.
  const change = (now, then) => Math.round((now / then - 1) * 1000) / 10;

  // Every period for one series of { date, value } readings.
  function periods(readings) {
    const rows = readings.filter((r) => r.value != null).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = rows[rows.length - 1];
    if (!last) return null;
    const by = new Map(rows.map((r) => [r.date, r.value]));
    const out = { latest: last.value, latest_date: last.date };
    for (const p of PERIODS) {
      const from = back([...by.keys()], last.date, p.days, p.within);
      out[p.id] = from ? { pct: change(last.value, by.get(from)), from_date: from, from_value: by.get(from) } : null;
    }
    return out;
  }

  const median = (values) => {
    const sorted = values.slice().sort((a, b) => a - b), mid = sorted.length >> 1;
    if (!sorted.length) return null;
    return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
  };

  // Graphics cards, from dated rows of { series, current, msrp, price, date }.
  // The level is the median premium over MSRP across current-generation cards
  // in stock. A period figure is the median of each card's own price change,
  // over the cards in stock on both days.
  function cardStats(rows) {
    const current = rows.filter((r) => r.current);
    const dates = [...new Set(current.map((r) => r.date))].sort();
    if (!dates.length) return null;
    const latest = dates[dates.length - 1];
    const priced = (date) => new Map(current.filter((r) => r.date === date && r.price != null).map((r) => [r.series, r]));
    const premium = (date) => {
      const cards = [...priced(date).values()];
      return { date, value: median(cards.map((r) => change(r.price, r.msrp))), cards: cards.length };
    };
    const now = priced(latest);
    const out = { latest: premium(latest).value, latest_date: latest, cards: now.size, points: dates.map(premium).filter((p) => p.value != null) };
    for (const p of PERIODS) {
      const from = back(dates, latest, p.days, p.within);
      const then = from ? priced(from) : new Map();
      const moves = [...now.keys()].filter((card) => then.has(card)).map((card) => change(now.get(card).price, then.get(card).price));
      out[p.id] = moves.length ? { pct: median(moves), from_date: from, cards: moves.length } : null;
    }
    return out;
  }

  // Where a price is in its cycle. `readings` are { date, value }; the high is
  // the highest reading held, and the first day it was reached.
  function high(readings) {
    const rows = readings.filter((r) => r.value != null).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!rows.length) return null;
    const top = rows.reduce((a, b) => (b.value > a.value ? b : a)), last = rows[rows.length - 1];
    return { value: top.value, date: top.date, below_pct: change(last.value, top.value) };
  }

  // The verdict on a market, from three figures: how far the price is below
  // its high, its change over the last month and over the last three.
  // Within 2% of the high is at it; 10% or more below is past its peak.
  // A fall is faster when more than half of the three-month fall came in the
  // last month. A price at its high that rose 3% or more in three months and
  // is now steady has stalled.
  function cycle(belowPct, monthPct, quarterPct) {
    const at = belowPct >= -2, past = belowPct <= -10;
    const move = monthPct == null ? null : direction(monthPct);
    const tone = monthPct == null ? "" : meaning(monthPct);
    const faster = quarterPct != null && quarterPct < 0 && monthPct < quarterPct / 2;
    let text;
    if (move === null) text = at ? "At its high" : past ? "Past its peak" : "Below its high";
    else if (at) text = move === "Rising" ? "Still climbing" : move === "Falling" ? "Turning down from its high" : quarterPct != null && quarterPct >= 3 ? "Stalled at its high" : "Holding at its high";
    else if (past) text = move === "Falling" ? (faster ? "Past its peak and falling faster" : "Past its peak and falling") : move === "Rising" ? "Past its peak, rising again" : "Past its peak, holding";
    else text = move === "Rising" ? "Climbing back toward its high" : move === "Falling" ? "Coming off its high" : "Holding below its high";
    return { text, tone };
  }

  // DDR4 against DDR5 by the gigabit, from the 8Gb and 16Gb chip readings.
  // Compared on the latest day both have a reading, and on the first.
  function gigabit(ddr4, ddr5) {
    const five = new Map(ddr5.map((r) => [r.date, r.value]));
    const both = ddr4.filter((r) => five.has(r.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!both.length) return null;
    const on = (r) => ({ date: r.date, ddr4: r.value / 8, ddr5: five.get(r.date) / 16, pct: change(r.value / 8, five.get(r.date) / 16) });
    return { now: on(both[both.length - 1]), first: on(both[0]) };
  }

  // Where the premium on graphics cards sits, from one day's current cards
  // with a price: the median over MSRP for cards launched at $800 or more and
  // for cards under $400, and each card sold in two memory sizes.
  function cardSplit(rows) {
    const priced = rows.filter((r) => r.current && r.price != null).map((r) => ({ ...r, premium_pct: change(r.price, r.msrp) }));
    const tier = (list) => ({ pct: median(list.map((r) => r.premium_pct)), cards: list.length });
    const sized = priced.map((r) => ({ r, m: r.card.match(/^(.*) (\d+)GB$/) })).filter((x) => x.m);
    const pairs = [];
    for (const big of sized) {
      const small = sized.find((x) => x.m[1] === big.m[1] && +x.m[2] < +big.m[2]);
      if (small) pairs.push({ card: big.m[1], big_gb: +big.m[2], big_pct: big.r.premium_pct, small_gb: +small.m[2], small_pct: small.r.premium_pct });
    }
    return { top: tier(priced.filter((r) => r.msrp >= 800)), entry: tier(priced.filter((r) => r.msrp < 400)), pairs };
  }

  // What a kit and one named card cost together now, and on the first day
  // the card has a price, with the kit reading nearest to that day.
  function basket(kit, cards, name) {
    const mine = cards.filter((r) => r.series === name && r.price != null).sort((a, b) => (a.date < b.date ? -1 : 1));
    const kits = kit.filter((r) => r.value != null).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    if (mine.length < 2 || !kits.length) return null;
    const near = (date) => kits.reduce((a, b) => (Math.abs(Date.parse(b.date) - Date.parse(date)) < Math.abs(Date.parse(a.date) - Date.parse(date)) ? b : a));
    const pair = (card, k) => ({ card: card.price, card_date: card.date, kit: k.value, kit_date: k.date, total: card.price + k.value });
    const now = pair(mine[mine.length - 1], kits[kits.length - 1]), then = pair(mine[0], near(mine[0].date));
    return { now, then, more: now.total - then.total, pct: change(now.total, then.total) };
  }

  root.mmRules = { direction, meaning, PERIODS, back, change, periods, median, cardStats, high, cycle, gigabit, cardSplit, basket };
})(typeof window !== "undefined" ? window : globalThis);
