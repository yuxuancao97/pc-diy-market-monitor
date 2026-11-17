// Calculations and drawings for the page. Data comes from runtime.js.
(() => {
  const C = (i) => dash.colors[i % dash.colors.length];
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
    pctabs: (v) => (+v).toFixed(1) + '%',
    x1: (v) => (+v).toFixed(1),
    int: (v) => String(v),
    text: (v) => String(v),
    date: (v) => fDay(parse(v)),
    dateY: (v) => fDayY(parse(v)),
  };

  // Summaries. Each returns one row so every printed figure can be traced to it.
  dash.calc('ddr5_summary', {
    title: 'DDR5 16Gb spot, live against first saved reading',
    description: 'Session average on the live TrendForce board and its change from the first reading in the saved file.',
    inputs: ['ddr5_spot_points', 'dram_spot'],
    fn: (readings, board) => {
      const live = board.find((r) => r.item === 'DDR5 16Gb (2Gx8) 4800/5600');
      if (!readings.length || !live) return [];
      const first = readings[0];
      return [{ latest: live.session_avg, latest_date: live.as_of, first_date: first.date, change_first_pct: Math.round((live.session_avg / first.price - 1) * 1000) / 10 }];
    },
  });
  dash.calc('ddr4_summary', {
    title: 'DDR4 8Gb spot, latest against earlier readings',
    description: 'Latest reading against the one before it, the first in the file and the highest.',
    inputs: ['ddr4_spot_history'],
    fn: (readings) => {
      if (readings.length < 2) return [];
      const pct = (a, b) => Math.round((a / b - 1) * 1000) / 10;
      const first = readings[0], prev = readings[readings.length - 2], last = readings[readings.length - 1];
      const peak = readings.reduce((m, r) => (r.price > m.price ? r : m));
      return [{
        latest: last.price, latest_date: last.date,
        prev_date: prev.date, change_prev_pct: pct(last.price, prev.price),
        first_date: first.date, change_first_pct: pct(last.price, first.price),
        peak: peak.price, peak_date: peak.date, below_peak_pct: -pct(last.price, peak.price),
      }];
    },
  });
  dash.calc('ddr4_window', {
    title: 'DDR4 8Gb spot, change over the chart period',
    description: 'Latest reading against the first reading inside the chosen chart period.',
    inputs: ['ddr4_spot_history'],
    fn: (readings) => {
      if (readings.length < 2) return [];
      const days = { '1m': 31, '3m': 92, '6m': 183, '1y': 366 }[dash.params().range];
      const last = readings[readings.length - 1];
      let kept = readings;
      if (days) {
        const cut = new Date(Date.parse(last.date) - days * 864e5).toISOString().slice(0, 10);
        kept = readings.filter((r) => r.date >= cut);
        if (kept.length < 2) kept = readings.slice(-2);
      }
      return [{ from_date: kept[0].date, change_pct: Math.round((last.price / kept[0].price - 1) * 1000) / 10 }];
    },
  });
  dash.calc('kit_summary', {
    title: '32GB DDR5 kit, latest against a month and a year earlier',
    description: 'Cheapest listing now, against the last reading at least 30 days earlier and the last at least a year earlier.',
    inputs: ['ddr5_kit_retail'],
    fn: (readings) => {
      if (!readings.length) return [];
      const last = readings[readings.length - 1];
      const back = (days) => {
        const cut = new Date(Date.parse(last.date) - days * 864e5).toISOString().slice(0, 10);
        return readings.filter((r) => r.date <= cut).pop() || readings[0];
      };
      const month = back(30), year = back(365);
      return [{
        cheapest: last.cheapest, average: last.average, latest_date: last.date,
        month_date: month.date, change_month_pct: Math.round((last.cheapest / month.cheapest - 1) * 1000) / 10,
        year_date: year.date, multiple_year: Math.round((last.cheapest / year.cheapest) * 10) / 10,
      }];
    },
  });
  dash.calc('nand_summary', {
    title: '512Gb TLC wafer spot, live reading',
    description: 'Session average on the live TrendForce wafer board and the weekly change printed with it.',
    inputs: ['nand_wafer_board'],
    fn: (board) => {
      const live = board.find((r) => r.item === '512Gb TLC');
      return live ? [{ latest: live.session_avg, latest_date: live.as_of, weekly_change_pct: live.change_pct }] : [];
    },
  });
  dash.calc('spot_boards', {
    title: 'TrendForce spot boards, both pages',
    description: 'Rows from the DRAM page followed by the wafer row from the NAND flash page.',
    inputs: ['dram_spot', 'nand_wafer_board'],
    fn: (dram, wafer) => dram.concat(wafer),
  });
  dash.calc('gpu_summary', {
    title: 'Graphics cards, median premium over MSRP',
    description: 'Median of the printed premium over MSRP across cards with a new listing.',
    inputs: ['gpu_street'],
    fn: (cards) => {
      const priced = cards.filter((c) => c.street != null).map((c) => c.premium_pct).sort((a, b) => a - b);
      if (!priced.length) return [];
      const mid = priced.length >> 1;
      const median = priced.length % 2 ? priced[mid] : Math.round(((priced[mid - 1] + priced[mid]) / 2) * 10) / 10;
      return [{ median_premium_pct: median, priced: priced.length, no_stock: cards.length - priced.length, observed: cards.map((c) => c.observed).sort().pop() }];
    },
  });
  dash.calc('gpu_index_latest', {
    title: 'Newegg pilot index, latest capture',
    description: 'The last row of the index.',
    inputs: ['gpu_index'],
    fn: (captures) => (captures.length ? [captures[captures.length - 1]] : []),
  });

  // Chart period: rows dated within the chosen number of days before the latest row.
  const PERIOD_DAYS = { '1m': 31, '3m': 92, '6m': 183, '1y': 366 };
  function inPeriod(rows) {
    const days = PERIOD_DAYS[dash.params().range];
    if (!days || rows.length < 3) return rows;
    const cut = new Date(Date.parse(rows[rows.length - 1].date) - days * 864e5).toISOString().slice(0, 10);
    const kept = rows.filter((r) => r.date >= cut);
    return kept.length >= 2 ? kept : rows.slice(-2);
  }

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
    const tone = node.dataset.tone === 'price' && v != null;
    node.classList.toggle('mm-fav', tone && v < 0);
    node.classList.toggle('mm-adv', tone && v > 0);
  });

  // Moving tape of the spot boards. Rebuilt only when the rows change, so the motion never restarts on a redraw.
  dash.draw('tape', {
    mount: (box) => {
      const track = el('div', 'mm-tape-track');
      box.append(track);
      return { track, sig: '' };
    },
    update: (box, made) => {
      const got = dash.data('spot_boards');
      box.classList.toggle('mm-loading', got.status === 'loading');
      const rows = got.status === 'ok' && got.data ? got.data : [];
      const sig = JSON.stringify(rows.map((r) => [r.item, r.session_avg, r.change_pct]));
      if (sig === made.sig) return;
      made.sig = sig;
      const half = (hidden) => {
        const h = el('div', 'mm-tape-half');
        if (hidden) h.setAttribute('aria-hidden', 'true');
        rows.forEach((r) => {
          const item = el('span', 'mm-tape-item');
          const move = el('span', 'mm-move' + (r.change_pct < 0 ? ' mm-fav' : r.change_pct > 0 ? ' mm-adv' : ''), F.pct2(r.change_pct));
          item.append(el('span', 'mm-tape-name', r.item), el('span', 'mm-tape-val', chip(r.session_avg)), move);
          h.append(item);
        });
        return h;
      };
      made.track.replaceChildren(...(rows.length ? [half(false), half(true)] : []));
      made.track.style.animationDuration = Math.max(40, rows.length * 8) + 's';
    },
  });

  dash.draw('spark', (box) => {
    const got = rowsOf(box, [box.dataset.source], true);
    if (!got) return;
    const f = box.dataset.field, col = box.dataset.color ? 'var(' + box.dataset.color + ')' : col;
    const pts = got[0].filter((r) => r[f] != null).map((r) => ({ t: parse(r.date), v: +r[f] }));
    if (pts.length < 2) return box.replaceChildren();
    const W = Math.max(box.clientWidth, 80), H = 60;
    const x = d3.scaleUtc().domain(d3.extent(pts, (d) => d.t)).range([0, W - 8]);
    const [lo, hi] = d3.extent(pts, (d) => d.v);
    const y = d3.scaleLinear().domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi]).range([H - 12, 8]);
    const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', H)
      .attr('role', 'img').attr('aria-label', box.dataset.label || 'Trend');
    svg.append('path').attr('d', d3.area().x((d) => x(d.t)).y0(H).y1((d) => y(d.v))(pts)).style('fill', col).style('opacity', 0.2);
    svg.append('path').attr('d', d3.line().x((d) => x(d.t)).y((d) => y(d.v))(pts)).style('fill', 'none').style('stroke', col)
      .attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
    const last = pts[pts.length - 1];
    svg.append('circle').attr('cx', x(last.t)).attr('cy', y(last.v)).attr('r', 3.5).style('fill', col);
    box.replaceChildren(svg.node());
  });

  // Premium over MSRP per card as small bars, highest first.
  dash.draw('mini-bars', (box) => {
    const got = rowsOf(box, ['gpu_street'], true);
    if (!got) return;
    const vals = got[0].filter((r) => r.premium_pct != null).map((r) => r.premium_pct).sort((a, b) => b - a);
    if (!vals.length) return box.replaceChildren();
    const W = Math.max(box.clientWidth, 80), H = 60, gap = 3, bw = (W - 36 - gap * (vals.length - 1)) / vals.length;
    const y = d3.scaleLinear().domain([0, d3.max(vals)]).range([0, H - 12]);
    const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', H)
      .attr('role', 'img').attr('aria-label', box.dataset.label || 'Bars');
    svg.selectAll('rect').data(vals).join('rect').attr('x', (d, i) => 18 + i * (bw + gap)).attr('y', (d) => H - 12 - y(d))
      .attr('width', Math.max(bw, 1)).attr('height', (d) => Math.max(y(d), 1)).attr('rx', 2).style('fill', box.dataset.color ? 'var(' + box.dataset.color + ')' : C(0));
    box.replaceChildren(svg.node());
  });

  // The PC DRAM forecast as a bar on a scale that starts at zero.
  dash.draw('mini-range', (box) => {
    const got = rowsOf(box, ['trendforce_outlook'], true);
    if (!got) return;
    const rows = got[0].filter((r) => r.kind === 'contract'), row = rows.find((r) => r.metric === 'PC DRAM');
    if (!row) return box.replaceChildren();
    const W = Math.max(box.clientWidth, 80), H = 60;
    const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.high_pct)]).nice(4).range([18, W - 18]);
    const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', H)
      .attr('role', 'img').attr('aria-label', box.dataset.label || 'Range');
    svg.append('rect').attr('x', 18).attr('y', 14).attr('width', W - 36).attr('height', 10).attr('rx', 2).style('fill', 'var(--color-fg)').style('opacity', 0.14);
    svg.append('rect').attr('x', x(row.low_pct)).attr('y', 14).attr('width', Math.max(x(row.high_pct) - x(row.low_pct), 4)).attr('height', 10).attr('rx', 2).style('fill', C(0));
    svg.append('text').attr('class', 'mm-tick').attr('x', 18).attr('y', 44).text('0%');
    svg.append('text').attr('class', 'mm-tick').attr('x', W - 18).attr('y', 44).attr('text-anchor', 'end').text('+' + x.domain()[1] + '%');
    box.replaceChildren(svg.node());
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

  // Lines drawn point to point on an axis fitted to the period. A stretch longer than gapDays without a reading is dotted.
  function lineChart(box, o) {
    const W = Math.max(box.clientWidth, 260), H = o.height;
    const { svg, measure, show, hide } = stage(box, W, H, o.aria);
    const col = (i) => (o.colors && o.colors[i]) || C(i);
    const all = o.series.flatMap((s) => s.pts);
    const xfmt = (d3.max(all, (d) => d.t) - d3.min(all, (d) => d.t)) / 864e5 > 150 ? d3.utcFormat('%b %Y') : fDay;
    const [lo, hi] = d3.extent(all, (d) => d.v), pad = (hi - lo || Math.abs(hi) || 1) * 0.14;
    const y = d3.scaleLinear().domain([lo - pad < 0 && lo >= 0 ? 0 : lo - pad, hi + pad]).nice(4);
    const yt = y.ticks(4);
    const many = o.series.length > 1;
    const ends = o.series.map((s, i) => {
      const p = s.pts[s.pts.length - 1];
      return { i, p, text: (many ? s.label + ' ' : '') + o.fmt(p.v) };
    });
    const m = { t: 22, b: 30, l: d3.max(yt, (t) => measure(o.tick(t), 'mm-tick')) + 12, r: d3.max(ends, (e) => measure(e.text, 'mm-end')) + 16 };
    y.range([H - m.b, m.t]);
    const x = d3.scaleUtc().domain(d3.extent(all, (d) => d.t)).range([m.l, W - m.r]);
    svg.append('g').selectAll('text').data(yt).join('text').attr('class', 'mm-tick').attr('x', m.l - 10).attr('y', (d) => y(d))
      .attr('dy', '0.32em').attr('text-anchor', 'end').text((d) => o.tick(d));
    const xt = x.ticks(Math.max(2, Math.floor((W - m.l - m.r) / 96)));
    svg.append('g').selectAll('text').data(xt).join('text').attr('class', 'mm-tick').attr('x', (d) => x(d)).attr('y', H - 8)
      .attr('text-anchor', 'middle').text((d) => xfmt(d));
    o.series.forEach((s, i) => {
      const g = svg.append('g');
      if (i === 0) g.append('path').attr('d', d3.area().x((d) => x(d.t)).y0(H - m.b).y1((d) => y(d.v))(s.pts)).style('fill', col(0)).style('opacity', 0.16);
      for (let k = 1; k < s.pts.length; k++) {
        const a = s.pts[k - 1], b = s.pts[k];
        const gap = o.gapDays && (b.t - a.t) / 864e5 > o.gapDays;
        g.append('line').attr('x1', x(a.t)).attr('y1', y(a.v)).attr('x2', x(b.t)).attr('y2', y(b.v))
          .style('stroke', col(i)).attr('stroke-width', 2.5).attr('stroke-linecap', 'round')
          .attr('stroke-dasharray', gap ? '1 8' : null).style('opacity', gap ? 0.75 : 1);
      }
      g.selectAll('circle').data(s.pts).join('circle').attr('cx', (d) => x(d.t)).attr('cy', (d) => y(d.v)).attr('r', 3).style('fill', col(i));
    });
    if (!many) {
      const top = o.series[0].pts.reduce((a, b) => (b.v > a.v ? b : a)), last = ends[0].p;
      if (top.v > last.v && x(last.t) - x(top.t) > 70) {
        svg.append('circle').attr('cx', x(top.t)).attr('cy', y(top.v)).attr('r', 5).style('fill', col(0));
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
      const hits = o.series.map((s, i) => ({ s, i, p: s.pts.find((p) => +p.t === near) })).filter((h) => h.p);
      hover.selectAll('circle').data(hits).join('circle').attr('cx', (h) => x(h.p.t)).attr('cy', (h) => y(h.p.v)).attr('r', 6)
        .style('fill', (h) => col(h.i)).style('stroke', 'var(--color-panel)').attr('stroke-width', 2);
      show([fDayY(new Date(near))].concat(hits.map((h) => (many ? h.s.label + ' ' : '') + o.fmt(h.p.v))), x(new Date(near)), d3.min(hits, (h) => y(h.p.v)));
    };
    svg.on('pointermove', point).on('pointerdown', point).on('pointerleave', () => { hide(); hover.selectAll('circle').remove(); });
  }

  dash.draw('ddr4-chart', (box) => {
    const got = rowsOf(box, ['ddr4_spot_history']);
    if (!got) return;
    lineChart(box, {
      height: 280, gapDays: 45, colors: ['var(--c-ddr4)'], aria: 'DDR4 8Gb spot price by reading date, US dollars per chip',
      series: [{ label: 'spot', pts: inPeriod(got[0]).map((r) => ({ t: parse(r.date), v: r.price })) }],
      fmt: (v) => '$' + chip(v), tick: (v) => '$' + v,
    });
  });

  dash.draw('kit-chart', (box) => {
    const got = rowsOf(box, ['ddr5_kit_retail']);
    if (!got) return;
    lineChart(box, {
      height: 280, colors: ['var(--c-kit)', 'var(--color-fg)'], aria: 'Cheapest and average listing for a 2x16GB DDR5-6000 CL30 kit, US dollars',
      series: [
        { label: 'cheapest', pts: inPeriod(got[0]).map((r) => ({ t: parse(r.date), v: r.cheapest })) },
        { label: 'average', pts: inPeriod(got[0]).map((r) => ({ t: parse(r.date), v: r.average })) },
      ],
      fmt: (v) => '$' + d3.format(',.0f')(v), tick: (v) => '$' + v,
    });
  });

  dash.draw('index-chart', (box) => {
    const got = rowsOf(box, ['gpu_index']);
    if (!got) return;
    lineChart(box, {
      height: 220, colors: ['var(--c-gpu)'], aria: 'Median premium over launch price at Newegg by capture date, percent',
      series: [{ label: 'median', pts: inPeriod(got[0]).map((r) => ({ t: parse(r.date), v: r.median_premium_pct })) }],
      fmt: (v) => '+' + v.toFixed(1) + '%', tick: (v) => '+' + v + '%',
    });
  });

  dash.draw('board', (body) => {
    const got = dash.data('spot_boards');
    const rows = got.status === 'ok' && got.data ? got.data : [];
    const enc = (s) => String(s).replace(/[%&=]/g, (c) => encodeURIComponent(c));
    body.replaceChildren(...rows.map((r) => {
      const tr = el('tr');
      const change = el('td', 'mm-r');
      change.append(el('span', 'mm-move' + (r.change_pct < 0 ? ' mm-fav' : r.change_pct > 0 ? ' mm-adv' : ''), F.pct2(r.change_pct)));
      const span = el('div', 'mm-span');
      const end = (field) => {
        const n = el('span', 'mm-span-n', chip(r[field]));
        n.dataset.source = 'spot_boards';
        n.dataset.field = field;
        n.dataset.where = 'item=' + enc(r.item);
        return n;
      };
      const track = el('div', 'mm-track'), dot = el('span', 'mm-dot');
      dot.style.left = (r.high > r.low ? Math.min(Math.max((r.session_avg - r.low) / (r.high - r.low), 0), 1) * 100 : 50) + '%';
      track.append(dot);
      const lowEnd = end('low');
      lowEnd.style.textAlign = 'right';
      span.append(lowEnd, track, end('high'));
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
    g.append('rect').attr('x', (r) => x(r.low_pct)).attr('y', 11).attr('width', (r) => Math.max(x(r.high_pct) - x(r.low_pct), 4)).attr('height', 18).attr('rx', 5).style('fill', 'var(--c-contract)');
    g.append('text').attr('class', 'mm-end').attr('x', 0).attr('y', 17).text((r) => r.metric);
    g.append('text').attr('class', 'mm-tick').attr('x', 0).attr('y', 34).text((r) => 'published ' + F.date(r.published));
    g.append('text').attr('class', 'mm-end').attr('x', (r) => x(r.high_pct) + 9).attr('y', 20).attr('dy', '0.32em').text((r) => r.range_text);
    g.append('rect').attr('x', 0).attr('y', 0).attr('width', W).attr('height', rh).style('fill', 'transparent')
      .on('pointermove pointerdown', (ev, r) => show([r.metric + ', ' + r.period, r.range_text + ' on the quarter before', r.source_name + ', ' + F.dateY(r.published)],
        (x(r.low_pct) + x(r.high_pct)) / 2, top + rows.indexOf(r) * rh + 10))
      .on('pointerleave', hide);
  });

  dash.draw('gpu-bars', (box) => {
    const got = rowsOf(box, ['gpu_street']);
    if (!got) return;
    const priced = got[0].filter((r) => r.street != null).sort((a, b) => b.premium_pct - a.premium_pct);
    const rows = priced.concat(got[0].filter((r) => r.street == null));
    const name = (r) => (/GB$/.test(r.card) ? r.card : r.card + ' ' + r.vram);
    const pct = (r) => (r.street == null ? r.seller : F.pct1(r.premium_pct));
    const price = (r) => (r.street == null ? 'MSRP ' + money(r.msrp) : money(r.street) + ' from ' + money(r.msrp));
    const tone = (r) => (r.brand === 'NVIDIA' ? 'var(--c-gpu)' : r.brand === 'AMD' ? 'var(--c-amd)' : 'var(--color-fg-muted)');
    const W = Math.max(box.clientWidth, 260), narrow = W < 560, rh = narrow ? 50 : 34, H = rows.length * rh + 4;
    const { svg, measure, show, hide } = stage(box, W, H, 'Lowest new price over MSRP by graphics card, percent');
    const lw = narrow ? 0 : d3.max(rows, (r) => measure(name(r), 'mm-end')) + 16;
    const pw = d3.max(rows, (r) => measure(pct(r), 'mm-end')) + 12;
    const rw = narrow ? 0 : d3.max(rows, (r) => measure(price(r), 'mm-tick')) + 8;
    const x = d3.scaleLinear().domain([0, d3.max(priced, (r) => r.premium_pct) || 1]).range([lw, W - rw - pw]);
    const g = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (r, i) => `translate(0,${i * rh})`);
    const by = narrow ? 30 : 10, bh = narrow ? 10 : 14, ty = narrow ? 18 : 17;
    g.filter((r) => r.street != null).append('rect').attr('x', x(0)).attr('y', by).attr('width', (r) => Math.max(x(r.premium_pct) - x(0), 3)).attr('height', bh).attr('rx', 2).style('fill', tone);
    g.append('text').attr('class', 'mm-end').attr('x', 0).attr('y', ty).attr('dy', narrow ? 0 : '0.32em').text(name);
    if (narrow) {
      g.append('text').attr('class', 'mm-tick').attr('x', W).attr('y', ty).attr('text-anchor', 'end').text((r) => (r.street == null ? r.seller : F.pct1(r.premium_pct) + '  ' + money(r.street)));
    } else {
      g.append('text').attr('class', (r) => (r.street == null ? 'mm-tick' : 'mm-end')).attr('x', (r) => (r.street == null ? x(0) : x(r.premium_pct) + 9)).attr('y', ty).attr('dy', '0.32em').text(pct);
      g.append('text').attr('class', 'mm-tick').attr('x', W).attr('y', ty).attr('dy', '0.32em').attr('text-anchor', 'end').text(price);
    }
    g.append('rect').attr('x', 0).attr('y', 0).attr('width', W).attr('height', rh).style('fill', 'transparent')
      .on('pointermove pointerdown', (ev, r) => show(
        r.street == null
          ? [name(r), 'MSRP ' + money(r.msrp), r.seller]
          : [name(r), 'MSRP ' + money(r.msrp), 'Lowest new ' + money(r.street), F.pct1(r.premium_pct) + ' over MSRP', r.seller],
        d3.pointer(ev, svg.node())[0], rows.indexOf(r) * rh))
      .on('pointerleave', hide);
  });

  // Where each figure stands inside its own range. Every bound is a value from the data.
  function dialOf(kind) {
    const rows = (id) => { const got = dash.data(id); return got.status === 'ok' && got.data ? got.data : null; };
    if (kind === 'ddr5' || kind === 'nand') {
      const board = rows(kind === 'ddr5' ? 'dram_spot' : 'nand_wafer_board');
      const row = board && board.find((r) => r.item === (kind === 'ddr5' ? 'DDR5 16Gb (2Gx8) 4800/5600' : '512Gb TLC'));
      return row ? { lo: row.low, hi: row.high, at: row.session_avg, note: (kind === 'ddr5' ? 'Session ' : 'Week ') + chip(row.low) + ' to ' + chip(row.high) } : null;
    }
    if (kind === 'ddr4' || kind === 'kit') {
      const all = rows(kind === 'ddr4' ? 'ddr4_spot_history' : 'ddr5_kit_retail'), f = kind === 'ddr4' ? 'price' : 'cheapest';
      if (!all || !all.length) return null;
      const lo = d3.min(all, (r) => r[f]), hi = d3.max(all, (r) => r[f]);
      const show = kind === 'ddr4' ? (v) => '$' + chip(v) : F.usd0;
      return { lo, hi, at: all[all.length - 1][f], note: show(lo) + ' to ' + show(hi) + ' since ' + F.dateY(all[0].date) };
    }
    if (kind === 'gpu') {
      const cards = rows('gpu_street'), mid = rows('gpu_summary');
      const pcts = cards ? cards.filter((c) => c.premium_pct != null).map((c) => c.premium_pct) : [];
      if (!pcts.length || !mid || !mid[0]) return null;
      return { lo: d3.min(pcts), hi: d3.max(pcts), at: mid[0].median_premium_pct, note: 'Cards from ' + F.pct1(d3.min(pcts)) + ' to ' + F.pct1(d3.max(pcts)) };
    }
    const outlook = rows('trendforce_outlook'), row = outlook && outlook.find((r) => r.metric === 'PC DRAM');
    if (!row) return null;
    const top = d3.scaleLinear().domain([0, d3.max(outlook.filter((r) => r.kind === 'contract'), (r) => r.high_pct)]).nice(4).domain()[1];
    return { lo: 0, hi: top, from: row.low_pct, at: row.high_pct, note: 'On a scale of 0 to +' + top + '%' };
  }
  dash.draw('dial', (box) => {
    const d = dialOf(box.dataset.dial);
    box.classList.toggle('mm-loading', !d);
    if (!d) return box.replaceChildren();
    const a0 = -Math.PI * 0.72, a1 = Math.PI * 0.72;
    const arc = d3.arc().innerRadius(60).outerRadius(72).cornerRadius(6);
    const pos = (v) => a0 + (a1 - a0) * Math.min(Math.max(d.hi > d.lo ? (v - d.lo) / (d.hi - d.lo) : 1, 0), 1);
    const svg = d3.create('svg').attr('viewBox', '0 0 170 124').attr('width', '100%').attr('role', 'img').attr('aria-label', box.dataset.label || 'Range');
    const g = svg.append('g').attr('transform', 'translate(85,80)');
    g.append('path').attr('d', arc({ startAngle: a0, endAngle: a1 })).style('fill', 'var(--color-track)');
    const from = d.from != null ? pos(d.from) : a0;
    g.append('path').attr('d', arc({ startAngle: from, endAngle: Math.min(Math.max(pos(d.at), from + 0.14), a1) })).style('fill', 'var(' + box.dataset.color + ')');
    box.replaceChildren(svg.node());
  });
  dash.draw('dial-range', (node) => {
    const d = dialOf(node.dataset.dial);
    node.textContent = d ? d.note : '';
  });
  dash.draw('status', (node) => {
    const got = dash.data('meta');
    if (got.status !== 'ok' || !got.data.sources) { node.textContent = ''; return; }
    const read = got.data.sources.filter((s) => s.ok).length;
    node.textContent = read + ' of ' + got.data.sources.length + ' sources read ' + d3.utcFormat('%b %-d, %H:%M UTC')(new Date(got.data.generated_at));
  });

  // Sources named in the data, each linked once, then how the last refresh went.
  dash.draw('sources', (list) => {
    const ids = ['dram_spot', 'nand_wafer_board', 'ddr4_spot_history', 'ddr5_spot_points', 'ddr5_kit_retail', 'nand_wafer_spot', 'trendforce_outlook', 'gpu_street', 'gpu_index'];
    const seen = new Map(), meta = dash.data('meta');
    // A page that is re-read goes by the name the refresh gives it.
    if (meta.status === 'ok' && meta.data.sources) meta.data.sources.forEach((s) => seen.set(s.url, seen.has(s.url) ? seen.get(s.url) + ' and ' + s.title.replace(/^Capital & Compute /, '') : s.title));
    ids.forEach((id) => {
      const got = dash.data(id);
      if (got.status === 'ok') got.data.forEach((r) => { if (r.source_url && !seen.has(r.source_url)) seen.set(r.source_url, r.source_name); });
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
  dash.onData(() => {
    const now = dash.params().range || 'all';
    document.querySelectorAll('.mm-rbtn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === now)));
  });
  document.querySelectorAll('.mm-sw').forEach((n) => { n.style.background = n.dataset.color ? 'var(' + n.dataset.color + ')' : C(+n.dataset.series || 0); });
})();
