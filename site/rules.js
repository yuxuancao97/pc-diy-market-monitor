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

  // Where a price stands against its reference: the same price a year ago,
  // or the launch price for a graphics card.
  const level = (pct) => (pct >= 100 ? "Far above" : pct >= 25 ? "Well above" : pct >= 5 ? "Above" : pct > -5 ? "Close to" : pct > -25 ? "Below" : "Well below");
  const levelMeaning = (pct) => (pct >= 5 ? "bad" : pct <= -5 ? "good" : "");

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

  // The two halves of a verdict. `levelPct` is the price against its
  // reference, `monthPct` its change over the last month; either may be null.
  function verdict(levelPct, monthPct, reference) {
    return {
      level: levelPct == null ? null : level(levelPct) + " " + reference,
      level_tone: levelPct == null ? "" : levelMeaning(levelPct),
      move: monthPct == null ? null : direction(monthPct) + " this month",
      move_tone: monthPct == null ? "" : meaning(monthPct),
    };
  }

  root.mmRules = { direction, meaning, PERIODS, back, change, periods, level, levelMeaning, median, cardStats, verdict };
})(typeof window !== "undefined" ? window : globalThis);
