// A small data layer for the page: it loads the JSON files, runs the
// calculations that depend on them, and redraws when data, the chart period
// or the window width changes.
(() => {
  const FILES = ["dram_spot", "nand_wafer_board", "ddr4_spot_history", "ddr5_spot_points", "ddr5_kit_retail", "nand_wafer_spot", "trendforce_outlook", "gpu_street", "gpu_index", "meta"];
  const store = {}, state = {}, calcs = {}, draws = [], watchers = [], made = new WeakMap();
  const params = { range: "all" };
  FILES.forEach((id) => { state[id] = "loading"; });

  const dash = window.dash = {
    colors: ["var(--series-1)", "var(--series-2)"],
    data(id) {
      const calc = calcs[id];
      if (!calc) return { status: state[id] || "missing", data: store[id] || [] };
      const inputs = calc.inputs.map((input) => dash.data(input));
      if (inputs.some((input) => input.status === "error")) return { status: "error", data: null };
      if (!inputs.every((input) => input.status === "ok")) return { status: "loading", data: null };
      try { return { status: "ok", data: calc.fn(...inputs.map((input) => input.data)) }; } catch { return { status: "error", data: null }; }
    },
    calc(id, definition) { calcs[id] = definition; },
    draw(name, drawing) { draws.push([name, drawing]); },
    onData(fn) { watchers.push(fn); },
    params: () => ({ ...params }),
    setParams(next) { Object.assign(params, next); run(); },
  };

  function run() {
    watchers.forEach((fn) => fn());
    for (const [name, drawing] of draws) {
      document.querySelectorAll(`[data-draw="${name}"]`).forEach((node) => {
        if (typeof drawing === "function") return drawing(node);
        if (!made.has(node)) { node.replaceChildren(); made.set(node, drawing.mount(node)); }
        drawing.update(node, made.get(node));
      });
    }
  }
  let queued = 0;
  const schedule = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; run(); }); };

  addEventListener("resize", schedule);
  addEventListener("DOMContentLoaded", schedule);
  FILES.forEach((id) => fetch(`data/${id}.json`, { cache: "no-cache" })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(response.status))))
    .then((rows) => { store[id] = rows; state[id] = "ok"; }, () => { state[id] = "error"; })
    .then(schedule));
})();
