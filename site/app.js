// Calculations and drawings for the page. Data comes from runtime.js, and
// every judgement about a number from rules.js.
(() => {
  const R = mmRules;
  const C = (i) => dash.colors[i % dash.colors.length];
  const DAY = 864e5;
  const parse = d3.utcParse('%Y-%m-%d');
  const fDay = d3.utcFormat('%b %-d');
  const fDayY = d3.utcFormat('%b %-d, %Y');
  const chip = (v) => { const s = (+v).toFixed(3); return s.endsWith('0') ? s.slice(0, -1) : s; };
  const money = (v) => '$' + d3.format(',.2f')(v).replace(/\.00$/, '');
  const signed = (n) => (v) => (v > 0 ? '+' : '') + (+v).toFixed(n) + '%';
  const F = {
    usd3: (v) => '$' + chip(v),
    usd0: (v) => '$' + d3.format(',.0f')(v),
    pct1: signed(1),
    pct2: signed(2),
    int: (v) => String(v),
    text: (v) => String(v),
    date: (v) => fDay(parse(v)),
    dateY: (v) => fDayY(parse(v)),
    age: (v) => { const days = Math.round((Date.now() - parse(v)) / DAY); return days <= 0 ? 'today' : days === 1 ? '1 day ago' : days + ' days ago'; },
  };

  // The key prices, in the order of the table. `fmt` prints a level, `axis` a tick.
  const SPOT = [
    { id: 'ddr5', plain: 'DDR5 memory chips', exact: 'DDR5 16Gb (2Gx8) 4800/5600, spot', unit: 'US$ per chip', series: 'DDR5 16Gb (2Gx8) 4800/5600' },
    { id: 'ddr4', plain: 'DDR4 memory chips', exact: 'DDR4 8Gb (1Gx8) 3200, spot', unit: 'US$ per chip', series: 'DDR4 8Gb (1Gx8) 3200' },
    { id: 'gddr6', plain: 'Graphics memory chips', exact: 'GDDR6 8Gb, spot', unit: 'US$ per chip', series: 'GDDR6 8Gb' },
    { id: 'nand', plain: 'SSD flash wafers', exact: '512Gb TLC NAND wafer, spot', unit: 'US$', series: '512Gb TLC' },
  ];
  const ORDER = ['ddr5', 'ddr4', 'kit', 'gddr6', 'nand', 'gpu'];

  dash.calc('key_prices', {
    title: 'Key prices with the same four periods',
    description: 'Latest reading of each price and its change against the reading nearest to a week, a month, three months and a year earlier.',
    inputs: ['spot_history', 'ddr5_kit_retail', 'gpu_history'],
    fn: (spot, kit, cards) => {
      const rows = SPOT.map((k) => {
        const points = spot.filter((r) => r.series === k.series).map((r) => ({ date: r.date, value: r.price }));
        return { ...k, fmt: 'usd3', ...(R.periods(points) || {}), points };
      });
      const kitPoints = kit.map((r) => ({ date: r.date, value: r.cheapest }));
      rows.push({
        id: 'kit', plain: '32GB DDR5 kit in shops', exact: '2x16GB DDR5-6000 CL30, cheapest listing', unit: 'US$ per kit', fmt: 'usd0',
        ...(R.periods(kitPoints) || {}), points: kitPoints, second: kit.map((r) => ({ date: r.date, value: r.average })),
      });
      const stats = R.cardStats(cards);
      if (stats) {
        rows.push({
          id: 'gpu', plain: 'Graphics cards', exact: 'Median of ' + stats.cards + ' current cards, best US price over MSRP', unit: 'percent over MSRP', fmt: 'pct1', over: true,
          ...stats,
        });
      }
      return ORDER.map((id) => rows.find((r) => r.id === id)).filter((r) => r && r.latest != null);
    },
  });

  dash.calc('health', {
    title: 'Market health',
    description: 'For each market, where its lead price is in its cycle: how far below its high, and its change over the last month against the last three.',
    inputs: ['key_prices'],
    fn: (keys) => {
      const of = (id) => keys.find((k) => k.id === id);
      const chips = of('ddr5');
      const made = (market, key, basis) => {
        if (!key) return null;
        // A premium over MSRP is turned into a price level, 100 at MSRP, before it is compared with its high.
        const top = R.high(key.points.map((p) => ({ date: p.date, value: key.over ? 100 + p.value : p.value })));
        return { market, basis, id: key.id, key, high: top, high_value: key.over ? top.value - 100 : top.value, ...R.cycle(top.below_pct, key.m1 ? key.m1.pct : null, key.m3 ? key.m3.pct : null) };
      };
      const rows = [
        made('Memory chips', chips, 'DDR5 16Gb chip, spot'),
        made('Memory in shops', of('kit'), '32GB DDR5 kit, cheapest listing'),
        made('Storage', of('nand'), '512Gb TLC flash wafer, spot'),
        made('Graphics cards', of('gpu'), 'Median current card'),
      ].filter(Boolean);
      // Shop memory is read beside the chips it is built from.
      const shops = rows.find((r) => r.id === 'kit');
      if (shops && chips && chips.m1) shops.beside = { label: 'DDR5 chip', pct: chips.m1.pct, from_date: chips.m1.from_date };
      return rows;
    },
  });

  const CARD = 'GeForce RTX 5070';
  dash.calc('worth_knowing', {
    title: 'Three comparisons across markets',
    description: 'DDR4 against DDR5 by the gigabit, where the graphics card premium sits, and what a kit and one card cost together.',
    inputs: ['spot_history', 'ddr5_kit_retail', 'gpu_history', 'gpu_latest'],
    fn: (spot, kit, cards, latest) => {
      const series = (name) => spot.filter((r) => r.series === name).map((r) => ({ date: r.date, value: r.price }));
      return [{
        gigabit: R.gigabit(series('DDR4 8Gb (1Gx8) 3200'), series('DDR5 16Gb (2Gx8) 4800/5600')),
        split: R.cardSplit(latest),
        basket: R.basket(kit.map((r) => ({ date: r.date, value: r.cheapest })), cards, CARD),
      }];
    },
  });

  dash.calc('spot_boards', {
    title: 'TrendForce spot boards, both pages',
    description: 'Rows from the DRAM page followed by the wafer row from the NAND flash page.',
    inputs: ['dram_spot', 'nand_wafer_board'],
    fn: (dram, wafer) => dram.concat(wafer),
  });
  dash.calc('gpu_latest', {
    title: 'Graphics cards on the latest day read',
    description: 'Every card on the tracker on its latest day, with the premium of its best US price over MSRP.',
    inputs: ['gpu_history'],
    fn: (rows) => {
      const latest = rows.reduce((d, r) => (r.date > d ? r.date : d), '');
      return rows.filter((r) => r.date === latest).map((r) => ({ ...r, premium_pct: r.price == null ? null : R.change(r.price, r.msrp) }));
    },
  });
  dash.calc('gpu_index_latest', {
    title: 'Newegg pilot index, latest capture',
    description: 'The last row of the index.',
    inputs: ['gpu_index'],
    fn: (captures) => (captures.length ? [captures[captures.length - 1]] : []),
  });

  // Loading and failure states shared by every drawing.
  function rowsOf(el, ids, quiet) {
    const got = ids.map((id) => dash.data(id));
    el.classList.toggle('mm-loading', got.some((g) => g.status === 'loading'));
    if (got.every((g) => g.status === 'ok' && g.data)) return got.map((g) => g.data);
    el.replaceChildren();
    if (!quiet && got.some((g) => g.status === 'error')) {
      const p = document.createElement('p');
      p.className = 'mm-fail';
      p.textContent = 'Failed to load';
      el.append(p);
    }
    return null;
  }
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const tone = (means) => (means === 'good' ? ' mm-good' : means === 'bad' ? ' mm-bad' : '');
  const level = (key, v) => (key.over ? F.pct1(v) + ' over MSRP' : F[key.fmt](v));

  // One value from one row, formatted by data-fmt.
  dash.draw('val', (node) => {
    const got = rowsOf(node, [node.dataset.source], true);
    if (!got) return;
    let row;
    if (node.dataset.where) {
      const i = node.dataset.where.indexOf('=');
      const key = node.dataset.where.slice(0, i), want = decodeURIComponent(node.dataset.where.slice(i + 1));
      row = got[0].find((r) => String(r[key]) === want);
    } else {
      row = got[0][+(node.dataset.row || 0)];
    }
    const v = row ? row[node.dataset.field] : null;
    node.textContent = v == null ? '' : (F[node.dataset.fmt] || String)(v);
  });

  // Market health: a verdict per market on where its price is in its cycle,
  // then the figures the verdict rests on, each with its date.
  dash.draw('health', (box) => {
    const got = rowsOf(box, ['health']);
    if (!got) return;
    const unsigned = (v) => Math.abs(v).toFixed(1) + '%';
    box.replaceChildren(...got[0].map((h) => {
      const k = h.key, card = el('div', 'mm-verdict');
      card.append(el('p', 'mm-verdict-market', h.market));
      card.append(el('p', 'mm-verdict-level' + tone(h.tone), h.text));
      const facts = el('ul', 'mm-verdict-facts');
      const fact = (text, cls) => facts.append(el('li', cls || '', text));
      fact(h.basis + ': ' + level(k, k.latest) + ' on ' + F.date(k.latest_date));
      const top = level(k, h.high_value) + ' on ' + F.date(h.high.date);
      fact(h.high.below_pct === 0 ? 'Its highest reading, first reached ' + F.date(h.high.date) : unsigned(h.high.below_pct) + ' below its high of ' + top);
      fact(k.m1 ? F.pct1(k.m1.pct) + ' this month, since ' + F.date(k.m1.from_date) : 'No reading a month ago');
      if (k.m3) fact(F.pct1(k.m3.pct) + ' in three months, since ' + F.date(k.m3.from_date));
      if (h.beside) fact(h.beside.label + ' over the same month: ' + F.pct1(h.beside.pct));
      if (!k.over && k.y1) fact(F.pct1(k.y1.pct) + ' in a year, since ' + F.dateY(k.y1.from_date), 'mm-dim');
      card.append(facts);
      return card;
    }));
  });

  // Worth knowing: three comparisons that the single prices do not show.
  dash.draw('worth', (list) => {
    const got = rowsOf(list, ['worth_knowing']);
    if (!got) return;
    const { gigabit, split, basket } = got[0][0], items = [];
    const item = (lead, detail) => {
      const li = el('li', 'mm-worth-item');
      li.append(el('p', 'mm-worth-lead', lead), el('p', 'mm-worth-detail', detail));
      items.push(li);
    };
    const usd2 = (v) => '$' + v.toFixed(2);
    if (gigabit) {
      const n = gigabit.now, f = gigabit.first, word = (pct) => (pct >= 1 ? Math.abs(pct).toFixed(1) + '% more' : pct <= -1 ? Math.abs(pct).toFixed(1) + '% less' : 'the same');
      item(n.pct >= 1 ? 'DDR4 is the dearer memory by the gigabit' : n.pct <= -1 ? 'DDR4 is the cheaper memory by the gigabit' : 'DDR4 and DDR5 cost the same by the gigabit',
        'A DDR4 chip costs ' + usd2(n.ddr4) + ' a gigabit against ' + usd2(n.ddr5) + ' for DDR5, ' + word(n.pct) + ', on ' + F.date(n.date) + '. On ' + F.dateY(f.date) + ' it cost ' + word(f.pct) + '.');
    }
    if (split && split.top.pct != null && split.entry.pct != null) {
      const pairs = split.pairs.map((p) => p.card.replace(/^(GeForce|Radeon|Intel) /, '') + ' ' + p.big_gb + 'GB ' + F.pct1(p.big_pct) + ' against ' + F.pct1(p.small_pct) + ' for ' + p.small_gb + 'GB');
      item(split.top.pct > split.entry.pct ? 'The graphics card premium is largest at the top' : 'The graphics card premium is largest at the entry level',
        'Median over MSRP: ' + F.pct1(split.top.pct) + ' across the ' + split.top.cards + ' cards launched at $800 or more, ' + F.pct1(split.entry.pct) + ' across the ' + split.entry.cards + ' launched under $400.'
        + (pairs.length ? ' Where a card is sold in two memory sizes: ' + pairs.join(', ') + '.' : ''));
    }
    if (basket) {
      const name = CARD.replace(/^GeForce /, ''), n = basket.now, t = basket.then;
      item('A 32GB kit and an ' + name + ' cost ' + F.usd0(n.total) + ' together, ' + F.usd0(Math.abs(basket.more)) + (basket.more >= 0 ? ' more' : ' less') + ' than early this year',
        'Now: kit ' + F.usd0(n.kit) + ' on ' + F.date(n.kit_date) + ', card ' + F.usd0(n.card) + ' on ' + F.date(n.card_date) + '. Then: kit ' + F.usd0(t.kit) + ' on ' + F.date(t.kit_date) + ', card ' + F.usd0(t.card) + ' on ' + F.date(t.card_date) + ', ' + F.usd0(t.total) + ' together. ' + F.pct1(basket.pct) + '.');
    }
    list.replaceChildren(...items);
  });

  // The window every trend in the key table is drawn on: the year up to the latest reading of any row.
  const yearWindow = (keys) => {
    const end = keys.reduce((d, k) => (k.latest_date > d ? k.latest_date : d), '');
    return [new Date(+parse(end) - 365 * DAY), parse(end)];
  };

  function spark(box, key, span) {
    const pts = key.points.map((p) => ({ t: parse(p.date), v: +p.value })).filter((p) => p.t >= span[0] && p.t <= span[1]);
    if (pts.length < 2) return;
    const W = Math.max(box.clientWidth, 80), H = 40;
    const x = d3.scaleUtc().domain(span).range([2, W - 6]);
    const y = d3.scaleLinear().domain([Math.min(0, d3.min(pts, (d) => d.v)), d3.max(pts, (d) => d.v)]).range([H - 4, 6]);
    const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', H)
      .attr('role', 'img').attr('aria-label', key.plain + ' over the past year');
    svg.append('path').attr('d', d3.area().x((d) => x(d.t)).y0(y(0)).y1((d) => y(d.v))(pts)).style('fill', C(0)).style('opacity', 0.18);
    svg.append('path').attr('d', d3.line().x((d) => x(d.t)).y((d) => y(d.v))(pts)).style('fill', 'none').style('stroke', C(0))
      .attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
    const last = pts[pts.length - 1];
    svg.append('circle').attr('cx', x(last.t)).attr('cy', y(last.v)).attr('r', 3.5).style('fill', C(0));
    box.replaceChildren(svg.node());
  }

  // Key prices: a row per price, the same period in the same column.
  dash.draw('key', (body) => {
    const got = rowsOf(body, ['key_prices'], true);
    if (!got) return;
    const span = yearWindow(got[0]);
    const sparks = [];
    body.replaceChildren(...got[0].map((k) => {
      const tr = el('tr');
      tr.id = 'row-' + k.id;
      const name = el('td', 'mm-k-name');
      name.append(el('span', 'mm-plain', k.plain), el('span', 'mm-sub', k.exact));
      const now = el('td', 'mm-k-now');
      now.append(el('span', 'mm-v mm-now', F[k.fmt](k.latest)), el('span', 'mm-sub', (k.over ? 'over MSRP, ' : '') + F.date(k.latest_date)));
      tr.append(name, now);
      R.PERIODS.forEach((p) => {
        const td = el('td', 'mm-k-per'), got = k[p.id];
        td.dataset.label = p.label;
        if (got) {
          const move = el('span', 'mm-v mm-move' + tone(R.meaning(got.pct)), F.pct1(got.pct));
          move.title = (k.over ? 'Median price change of ' + got.cards + ' cards since ' : 'From ' + F[k.fmt](got.from_value) + ' on ') + F.dateY(got.from_date);
          td.append(move);
        } else {
          const none = el('span', 'mm-none', 'No reading');
          none.title = 'No reading within ' + p.within + ' days of ' + p.label + ' earlier';
          td.append(none);
        }
        tr.append(td);
      });
      const trend = el('td', 'mm-k-trend'), box = el('div', 'mm-spark');
      trend.append(box);
      tr.append(trend);
      sparks.push([box, k]);
      return tr;
    }));
    sparks.forEach(([box, k]) => spark(box, k, span));
  });

  function stage(box, W, H, aria) {
    const plot = el('div', 'mm-plot');
    const svg = d3.select(plot).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%')
      .attr('role', 'img').attr('aria-label', aria);
    const tip = el('div', 'mm-tip');
    tip.hidden = true;
    plot.append(tip);
    box.replaceChildren(plot);
    const measure = (s, cls) => {
      const t = svg.append('text').attr('class', cls).text(s);
      const w = t.node().getComputedTextLength();
      t.remove();
      return w;
    };
    const show = (lines, px, py) => {
      tip.replaceChildren(...lines.map((s, i) => el('div', i === 0 ? 'mm-tip-h' : '', s)));
      tip.hidden = false;
      const k = plot.clientWidth / W;
      tip.style.left = Math.min(Math.max(px * k - tip.offsetWidth / 2, 0), Math.max(plot.clientWidth - tip.offsetWidth, 0)) + 'px';
      tip.style.top = Math.max(py * k - tip.offsetHeight - 12, 0) + 'px';
    };
    const hide = () => { tip.hidden = true; };
    return { svg, measure, show, hide };
  }

  // Lines on a time axis that is the same for every chart: `span` is the
  // chosen period, so a series with a short record looks short. The value
  // axis starts at zero. A stretch longer than gapDays without a reading is
  // dotted.
  function lineChart(box, o) {
    const series = o.series.map((s) => ({ ...s, pts: s.pts.filter((p) => p.t >= o.span[0] && p.t <= o.span[1]) })).filter((s) => s.pts.length);
    if (!series.length) return box.replaceChildren(el('p', 'mm-fail', 'No readings in this period'));
    const W = Math.max(box.clientWidth, 240), H = o.height;
    const { svg, measure, show, hide } = stage(box, W, H, o.aria);
    const all = series.flatMap((s) => s.pts);
    // Month ticks name the year on the first tick and on each January.
    // Past 13 months every tick is a half year and carries its year.
    const days = (o.span[1] - o.span[0]) / DAY, long = days > 150, years = days > 400;
    const xfmt = (d, i) => (!long ? fDay(d) : years ? d3.utcFormat("%b '%y")(d) : i === 0 || d.getUTCMonth() === 0 ? d3.utcFormat('%b %Y')(d) : d3.utcFormat('%b')(d));
    const y = d3.scaleLinear().domain([Math.min(0, d3.min(all, (d) => d.v)), d3.max(all, (d) => d.v) * 1.12 || 1]).nice(4);
    const yt = y.ticks(4);
    const many = series.length > 1;
    const ends = series.map((s, i) => {
      const p = s.pts[s.pts.length - 1];
      return { i, p, text: (many ? s.label + ' ' : '') + o.fmt(p.v) };
    });
    const m = { t: 22, b: 30, l: d3.max(yt, (t) => measure(o.tick(t), 'mm-tick')) + 12, r: d3.max(ends, (e) => measure(e.text, 'mm-end')) + 16 };
    y.range([H - m.b, m.t]);
    const x = d3.scaleUtc().domain(o.span).range([m.l, W - m.r]);
    svg.append('g').selectAll('text').data(yt).join('text').attr('class', 'mm-tick').attr('x', m.l - 10).attr('y', (d) => y(d))
      .attr('dy', '0.32em').attr('text-anchor', 'end').text((d) => o.tick(d));
    // A tick whose label would touch the one before it is left out.
    let edge = -Infinity;
    const xt = (years ? x.ticks(d3.utcMonth.every(6)) : x.ticks(Math.max(3, Math.min(7, Math.floor((W - m.l - m.r) / 58))))).map((d, i) => ({ d, text: xfmt(d, i) })).filter((t) => {
      const half = measure(t.text, 'mm-tick') / 2;
      if (x(t.d) - half < edge + 8) return false;
      edge = x(t.d) + half;
      return true;
    });
    svg.append('g').selectAll('text').data(xt).join('text').attr('class', 'mm-tick').attr('x', (t) => x(t.d)).attr('y', H - 8)
      .attr('text-anchor', 'middle').text((t) => t.text);
    series.forEach((s, i) => {
      const g = svg.append('g');
      if (i === 0) g.append('path').attr('d', d3.area().x((d) => x(d.t)).y0(y(0)).y1((d) => y(d.v))(s.pts)).style('fill', C(0)).style('opacity', 0.14);
      for (let k = 1; k < s.pts.length; k++) {
        const a = s.pts[k - 1], b = s.pts[k];
        const gap = o.gapDays && (b.t - a.t) / DAY > o.gapDays;
        g.append('line').attr('x1', x(a.t)).attr('y1', y(a.v)).attr('x2', x(b.t)).attr('y2', y(b.v))
          .style('stroke', C(i)).attr('stroke-width', 2.25).attr('stroke-linecap', 'round')
          .attr('stroke-dasharray', gap ? '1 7' : null).style('opacity', gap ? 0.75 : 1);
      }
      if (s.pts.length <= 40) g.selectAll('circle').data(s.pts).join('circle').attr('cx', (d) => x(d.t)).attr('cy', (d) => y(d.v)).attr('r', 2.75).style('fill', C(i));
      else { const p = s.pts[s.pts.length - 1]; g.append('circle').attr('cx', x(p.t)).attr('cy', y(p.v)).attr('r', 3.5).style('fill', C(i)); }
    });
    if (!many) {
      const top = series[0].pts.reduce((a, b) => (b.v > a.v ? b : a)), last = ends[0].p;
      if (top.v > last.v && x(last.t) - x(top.t) > 70) {
        svg.append('circle').attr('cx', x(top.t)).attr('cy', y(top.v)).attr('r', 4.5).style('fill', C(0));
        svg.append('text').attr('class', 'mm-tick').attr('x', x(top.t) + (x(top.t) - m.l < 44 ? 9 : 0)).attr('y', y(top.v) - 11).attr('text-anchor', x(top.t) - m.l < 44 ? 'start' : 'middle').text('high ' + o.fmt(top.v));
      }
    }
    ends.sort((a, b) => y(a.p.v) - y(b.p.v));
    let floor = -Infinity;
    ends.forEach((e) => { e.y = Math.max(y(e.p.v), floor + 15); floor = e.y; });
    svg.append('g').selectAll('text').data(ends).join('text').attr('class', 'mm-end').attr('x', (e) => x(e.p.t) + 10).attr('y', (e) => e.y)
      .attr('dy', '0.32em').text((e) => e.text);
    const hover = svg.append('g');
    const stamps = Array.from(new Set(all.map((d) => +d.t))).sort((a, b) => a - b);
    const point = (ev) => {
      const t = +x.invert(d3.pointer(ev, svg.node())[0]);
      const near = stamps.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
      const hits = series.map((s, i) => ({ s, i, p: s.pts.find((p) => +p.t === near) })).filter((h) => h.p);
      hover.selectAll('circle').data(hits).join('circle').attr('cx', (h) => x(h.p.t)).attr('cy', (h) => y(h.p.v)).attr('r', 5.5)
        .style('fill', (h) => C(h.i)).style('stroke', 'var(--color-panel)').attr('stroke-width', 2);
      show([fDayY(new Date(near))].concat(hits.map((h) => (many ? h.s.label + ' ' : '') + o.fmt(h.p.v))), x(new Date(near)), d3.min(hits, (h) => y(h.p.v)));
    };
    svg.on('pointermove', point).on('pointerdown', point).on('pointerleave', () => { hide(); hover.selectAll('circle').remove(); });
  }

  // The chart period, counted back from the latest reading on the page.
  const PERIOD_DAYS = { '1m': 31, '3m': 92, '6m': 183, '1y': 366 };
  function chartSpan(keys, index) {
    const dates = keys.flatMap((k) => k.points.map((p) => p.date)).concat(index.map((r) => r.date)).sort();
    const end = parse(dates[dates.length - 1]), days = PERIOD_DAYS[dash.params().range];
    return [days ? new Date(+end - days * DAY) : parse(dates[0]), end];
  }

  // One chart per key price, all on the chosen period.
  dash.draw('history', (grid) => {
    const got = rowsOf(grid, ['key_prices', 'gpu_index']);
    if (!got) return;
    const span = chartSpan(got[0], got[1]);
    const charts = [];
    const cards = got[0].map((k) => {
      const card = el('div', 'mm-card'), box = el('div', 'mm-chart');
      card.id = 'chart-' + k.id;
      card.append(el('h3', 'mm-h3', k.plain), el('p', 'mm-muted', k.exact + '. ' + k.unit[0].toUpperCase() + k.unit.slice(1) + '.'));
      if (k.second) {
        const legend = el('p', 'mm-legend');
        ['Cheapest listing', 'Average listing'].forEach((label, i) => {
          const item = el('span', 'mm-legend-key'), sw = el('span', 'mm-sw');
          sw.style.background = C(i);
          item.append(sw, label);
          legend.append(item);
        });
        card.append(legend);
      }
      card.append(box);
      const pts = (rows) => rows.map((p) => ({ t: parse(p.date), v: +p.value }));
      const series = [{ label: k.second ? 'cheapest' : k.plain, pts: pts(k.points) }];
      if (k.second) series.push({ label: 'average', pts: pts(k.second) });
      charts.push([box, {
        height: 230, gapDays: 45, span, series, aria: k.plain + ', ' + k.exact + ', by reading date',
        fmt: (v) => (k.over ? F.pct1(v) : F[k.fmt](v)),
        tick: (v) => (k.over ? (v > 0 ? '+' : '') + v + '%' : '$' + v),
      }]);
      return card;
    });
    grid.replaceChildren(...cards);
    charts.forEach(([box, o]) => lineChart(box, o));
  });

  dash.draw('index-chart', (box) => {
    const got = rowsOf(box, ['gpu_index', 'key_prices']);
    if (!got) return;
    lineChart(box, {
      height: 220, gapDays: 45, span: chartSpan(got[1], got[0]), aria: 'Median premium over launch price at Newegg by capture date, percent',
      series: [{ label: 'median', pts: got[0].map((r) => ({ t: parse(r.date), v: r.median_premium_pct })) }],
      fmt: (v) => '+' + v.toFixed(1) + '%', tick: (v) => (v > 0 ? '+' : '') + v + '%',
    });
  });

  dash.draw('board', (body) => {
    const got = dash.data('spot_boards');
    const rows = got.status === 'ok' && got.data ? got.data : [];
    body.replaceChildren(...rows.map((r) => {
      const tr = el('tr');
      const change = el('td', 'mm-r');
      change.append(el('span', 'mm-move' + tone(R.meaning(r.change_pct)), F.pct2(r.change_pct)));
      const span = el('div', 'mm-span');
      const track = el('div', 'mm-track'), dot = el('span', 'mm-dot');
      dot.style.left = (r.high > r.low ? Math.min(Math.max((r.session_avg - r.low) / (r.high - r.low), 0), 1) * 100 : 50) + '%';
      track.append(dot);
      const low = el('span', 'mm-span-n', chip(r.low));
      low.style.textAlign = 'right';
      span.append(low, track, el('span', 'mm-span-n', chip(r.high)));
      const wide = el('td');
      wide.append(span);
      tr.append(el('td', 'mm-item', r.item), el('td', 'mm-dim mm-col-board', r.board), el('td', 'mm-r mm-item', chip(r.session_avg)), change, wide, el('td', 'mm-r mm-dim mm-last', F.date(r.as_of)));
      return tr;
    }));
  });

  dash.draw('outlook', (box) => {
    const got = rowsOf(box, ['trendforce_outlook']);
    if (!got) return;
    const rows = got[0].filter((r) => r.kind === 'contract').sort((a, b) => b.high_pct - a.high_pct);
    const W = Math.max(box.clientWidth, 260), rh = 50, top = 6, H = top + rows.length * rh + 24;
    const { svg, measure, show, hide } = stage(box, W, H, 'Forecast contract price change on the quarter before, by segment');
    const lw = d3.max(rows, (r) => Math.max(measure(r.metric, 'mm-end'), measure('published ' + F.date(r.published), 'mm-tick'))) + 16;
    const rw = d3.max(rows, (r) => measure(r.range_text, 'mm-end')) + 14;
    const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.high_pct)]).nice(4).range([lw, W - rw]);
    svg.append('g').selectAll('text').data(x.ticks(4)).join('text').attr('class', 'mm-tick').attr('x', (d) => x(d)).attr('y', H - 6)
      .attr('text-anchor', 'middle').text((d) => (d > 0 ? '+' : '') + d + '%');
    const g = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (r, i) => `translate(0,${top + i * rh})`);
    g.append('rect').attr('x', x.range()[0]).attr('y', 11).attr('width', x.range()[1] - x.range()[0]).attr('height', 18).attr('rx', 2)
      .style('fill', 'var(--color-fg)').style('opacity', 0.1);
    g.append('rect').attr('x', (r) => x(r.low_pct)).attr('y', 11).attr('width', (r) => Math.max(x(r.high_pct) - x(r.low_pct), 4)).attr('height', 18).attr('rx', 5).style('fill', C(0));
    g.append('text').attr('class', 'mm-end').attr('x', 0).attr('y', 17).text((r) => r.metric);
    g.append('text').attr('class', 'mm-tick').attr('x', 0).attr('y', 34).text((r) => 'published ' + F.date(r.published));
    g.append('text').attr('class', 'mm-end').attr('x', (r) => x(r.high_pct) + 9).attr('y', 20).attr('dy', '0.32em').text((r) => r.range_text);
    g.append('rect').attr('x', 0).attr('y', 0).attr('width', W).attr('height', rh).style('fill', 'transparent')
      .on('pointermove pointerdown', (ev, r) => show([r.metric + ', ' + r.period, r.range_text + ' on the quarter before', r.source_name + ', ' + F.dateY(r.published)],
        (x(r.low_pct) + x(r.high_pct)) / 2, top + rows.indexOf(r) * rh + 10))
      .on('pointerleave', hide);
  });

  // Best US price over MSRP, a bar per card. data-gen picks current or earlier cards.
  dash.draw('gpu-bars', (box) => {
    const got = rowsOf(box, ['gpu_latest']);
    if (!got) return;
    const mine = got[0].filter((r) => r.current === (box.dataset.gen !== 'earlier'));
    const priced = mine.filter((r) => r.price != null).sort((a, b) => b.premium_pct - a.premium_pct);
    const rows = priced.concat(mine.filter((r) => r.price == null));
    if (!rows.length) return box.replaceChildren();
    const pct = (r) => (r.price == null ? 'Out of stock' : F.pct1(r.premium_pct));
    const price = (r) => (r.price == null ? 'MSRP ' + money(r.msrp) : money(r.price) + ', MSRP ' + money(r.msrp));
    const W = Math.max(box.clientWidth, 260), narrow = W < 560, rh = narrow ? 50 : 34, H = rows.length * rh + 4;
    const { svg, measure, show, hide } = stage(box, W, H, 'Best US price over MSRP by graphics card, percent');
    const lw = narrow ? 0 : d3.max(rows, (r) => measure(r.card, 'mm-end')) + 16;
    const pw = d3.max(rows, (r) => measure(pct(r), 'mm-end')) + 12;
    const rw = narrow ? 0 : d3.max(rows, (r) => measure(price(r), 'mm-tick')) + 8;
    const x = d3.scaleLinear().domain([Math.min(0, d3.min(priced, (r) => r.premium_pct) || 0), d3.max(priced, (r) => r.premium_pct) || 1]).range([lw, W - rw - pw]);
    const g = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (r, i) => `translate(0,${i * rh})`);
    const by = narrow ? 30 : 10, bh = narrow ? 10 : 14, ty = narrow ? 18 : 17;
    g.filter((r) => r.price != null).append('rect').attr('x', (r) => Math.min(x(0), x(r.premium_pct))).attr('y', by).attr('width', (r) => Math.max(Math.abs(x(r.premium_pct) - x(0)), 3)).attr('height', bh).attr('rx', 2).style('fill', C(0));
    g.append('text').attr('class', 'mm-end').attr('x', 0).attr('y', ty).attr('dy', narrow ? 0 : '0.32em').text((r) => r.card);
    if (narrow) {
      g.append('text').attr('class', 'mm-tick').attr('x', W).attr('y', ty).attr('text-anchor', 'end').text((r) => (r.price == null ? 'Out of stock' : F.pct1(r.premium_pct) + '  ' + money(r.price)));
    } else {
      g.append('text').attr('class', (r) => (r.price == null ? 'mm-tick' : 'mm-end' + tone(R.meaning(r.premium_pct)))).attr('x', (r) => (r.price == null ? x(0) : Math.max(x(r.premium_pct), x(0)) + 9)).attr('y', ty).attr('dy', '0.32em').text(pct);
      g.append('text').attr('class', 'mm-tick').attr('x', W).attr('y', ty).attr('dy', '0.32em').attr('text-anchor', 'end').text(price);
    }
    g.append('rect').attr('x', 0).attr('y', 0).attr('width', W).attr('height', rh).style('fill', 'transparent')
      .on('pointermove pointerdown', (ev, r) => show(
        r.price == null
          ? [r.card, 'MSRP ' + money(r.msrp), 'Out of stock', 'Lowest ever ' + money(r.lowest_ever)]
          : [r.card, 'MSRP ' + money(r.msrp), 'Best US price ' + money(r.price), F.pct1(r.premium_pct) + ' over MSRP', 'Lowest ever ' + money(r.lowest_ever)],
        d3.pointer(ev, svg.node())[0], rows.indexOf(r) * rh))
      .on('pointerleave', hide);
  });

  // When the sources were last read, and how long ago that was.
  dash.draw('status', (node) => {
    const got = dash.data('meta');
    if (got.status !== 'ok' || !got.data.sources) { node.textContent = ''; return; }
    const read = got.data.sources.filter((s) => s.ok).length, at = new Date(got.data.generated_at);
    const hours = Math.floor((Date.now() - at) / 36e5);
    const ago = hours < 1 ? 'under an hour ago' : hours === 1 ? '1 hour ago' : hours < 48 ? hours + ' hours ago' : Math.floor(hours / 24) + ' days ago';
    node.textContent = read + ' of ' + got.data.sources.length + ' sources read ' + d3.utcFormat('%b %-d, %H:%M UTC')(at) + ', ' + ago;
  });

  // Sources named in the data, each linked once, then how the last refresh
  // went. The archived copies of one page are one source, linked to the
  // archive's list of them.
  dash.draw('sources', (list) => {
    const ids = ['dram_spot', 'nand_wafer_board', 'spot_history', 'ddr5_kit_retail', 'trendforce_outlook', 'gpu_history', 'gpu_index'];
    const seen = new Map(), meta = dash.data('meta');
    if (meta.status === 'ok' && meta.data.sources) meta.data.sources.forEach((s) => seen.set(s.url, s.title));
    ids.forEach((id) => {
      const got = dash.data(id);
      if (got.status !== 'ok') return;
      got.data.forEach((r) => {
        if (!r.source_url) return;
        const url = r.captured ? r.source_url.replace(/\/web\/\d{14}\//, '/web/*/') : r.source_url;
        if (!seen.has(url)) seen.set(url, r.source_name);
      });
    });
    list.replaceChildren(...[...seen].map(([url, name]) => {
      const item = el('li'), link = el('a', 'mm-link', name);
      link.href = url;
      link.rel = 'noopener';
      item.append(link);
      return item;
    }));
  });
  dash.draw('refresh', (node) => {
    const got = dash.data('meta');
    if (got.status !== 'ok' || !got.data.generated_at) { node.textContent = ''; return; }
    const failed = got.data.sources.filter((s) => !s.ok);
    const when = d3.utcFormat('%b %-d, %H:%M UTC')(new Date(got.data.generated_at));
    node.textContent = failed.length
      ? when + '. Not read this time, so the last good reading is shown: ' + failed.map((s) => s.title).join(', ') + '.'
      : when + '. All ' + got.data.sources.length + ' pages read.';
  });

  document.querySelectorAll('.mm').forEach((n) => n.style.setProperty('--mm-accent', C(0)));
  document.querySelectorAll('.mm-rbtn').forEach((b) => b.addEventListener('click', () => dash.setParams({ range: b.dataset.range })));
  // A chart inside a closed section has no width to measure, so it is drawn again when the section opens.
  document.querySelectorAll('details').forEach((d) => d.addEventListener('toggle', () => dash.setParams({})));
  dash.onData(() => {
    const now = dash.params().range;
    document.querySelectorAll('.mm-rbtn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === now)));
  });
})();
