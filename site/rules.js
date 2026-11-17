// The one judgement the page makes about a number. Kept apart so it can be tested.
(function (root) {
  // A change of 1% or more either way has a direction; anything smaller is steady.
  const direction = (pct) => (pct <= -1 ? "Falling" : pct >= 1 ? "Rising" : "Steady");
  // For a builder a falling price is good and a rising one is bad.
  const meaning = (pct) => (pct <= -1 ? "good" : pct >= 1 ? "bad" : "");
  root.mmRules = { direction, meaning };
})(typeof window !== "undefined" ? window : globalThis);
