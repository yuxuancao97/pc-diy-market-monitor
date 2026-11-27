// The copy of site/ that GitHub Pages serves (scripts/build-public.mjs): it
// holds no comment, keeps the page and its data working, and is what the
// workflow publishes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build, findLeaks, markup, SOURCE } from "../scripts/build-public.mjs";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const temp = () => mkdtempSync(join(tmpdir(), "build-public-"));

test("the check finds planted comments and notes, and lets a licence through", () => {
  const dir = temp();
  const check = (name, text) => {
    writeFileSync(join(dir, name), text);
    const found = findLeaks(dir).join("\n");
    rmSync(join(dir, name));
    return found;
  };
  try {
    assert.match(check("a.js", "/* note */ x();\n/*! @license MIT */\n"), /a block comment/, "a licence later in the file does not excuse an earlier comment");
    assert.match(check("b.html", "<p>Hi</p><!-- for the team -->"), /an HTML comment/);
    assert.match(check("c.svg", "<svg><!-- exported --></svg>"), /an HTML comment/, "SVG files are checked");
    assert.match(check("d.css", "a{color:red} /* (owner, 2026-11-26) */"), /owner note/);
    assert.match(check("e.js", 'const s = "see docs/NOTES.md";'), /a repository path/);
    assert.match(check("f.js", 'const s = "built on the box at /Users/someone/x";'), /a machine name/);
    assert.match(check("g.json", '{"note":"TODO fix this"}'), /a working note/, "data files are checked");
    assert.equal(check("h.js", '/*! @license MIT */ x(); const u = "https://example.com/a/b";'), "", "a licence and a URL are not leaks");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("markup loses its comments but never inside a script, style or textarea", () => {
  const page = '<!-- top -->\n<p>a</p><textarea><!-- kept --></textarea><script type="application/ld+json">{"a":"<!-- kept -->"}</script><style>/* gone */ p { color: red }</style><script>/* gone */ var x = 1;</script>';
  const out = markup(page);
  assert.ok(!out.includes("top") && !out.includes("gone"), out);
  assert.equal(out.match(/<!-- kept -->/g).length, 2, out);
  assert.match(out, /<style>p\{color:red\}<\/style>/);
  assert.match(out, /<script>var x=1;<\/script>/);
});

test("the built copy of site/ has no comment and keeps the page working", async () => {
  const out = temp();
  try {
    build(SOURCE, out);
    assert.deepEqual(findLeaks(out), []);

    const list = (dir) => readdirSync(dir, { recursive: true }).sort();
    assert.deepEqual(list(out), list(SOURCE), "every file is copied");
    for (const name of readdirSync(join(SOURCE, "data"))) {
      assert.ok(readFileSync(join(out, "data", name)).equals(readFileSync(join(SOURCE, "data", name))), `data/${name} is copied byte for byte`);
    }

    // The workflow writes the build's name over __BUILD__ in the built page.
    const count = (text, s) => text.split(s).length - 1;
    const page = readFileSync(join(SOURCE, "index.html"), "utf8");
    const built = readFileSync(join(out, "index.html"), "utf8");
    assert.ok(count(page, "?v=__BUILD__") > 0);
    assert.equal(count(built, "?v=__BUILD__"), count(page, "?v=__BUILD__"));
    assert.equal(count(built, "__BUILD__"), count(page, "__BUILD__"));

    // The scripts share top-level names; minified, they must still answer alike.
    const load = (dir) => {
      const context = vm.createContext({});
      vm.runInContext(readFileSync(join(dir, "rules.js"), "utf8"), context);
      return context.mmRules;
    };
    const before = load(SOURCE), after = load(out);
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    assert.deepEqual(JSON.parse(JSON.stringify(after.PERIODS)), JSON.parse(JSON.stringify(before.PERIODS)));
    for (const file of ["runtime.js", "app.js"]) {
      const source = readFileSync(join(SOURCE, file), "utf8");
      const min = readFileSync(join(out, file), "utf8");
      for (const name of source.match(/\b(?:window\.\w+|mmRules|dash)\b/g) || []) assert.ok(min.includes(name), `${file} still names ${name}`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("the workflow publishes the built copy, never site/ as it is", () => {
  const flow = readFileSync(here("../.github/workflows/refresh.yml"), "utf8");
  const at = (s) => { const i = flow.indexOf(s); assert.ok(i >= 0, `the workflow has ${s}`); return i; };
  assert.ok(at("run: npm ci") < at("run: npm test"), "esbuild is installed before the tests");
  assert.ok(at("sed -i \"s/__BUILD__") < at("node scripts/build-public.mjs --check"), "the build is named before it is copied");
  assert.ok(at("node scripts/build-public.mjs --check") < at("node scripts/secret-scan.mjs .build/site"));
  assert.ok(at("git push -q -f") < at("node scripts/build-public.mjs --check"), "a leak never costs a data reading");
  assert.match(flow, /upload-pages-artifact@v\d+\n\s+with:\n\s+path: \.build\/site\n/);
});
