// The copy of site/ that GitHub Pages serves: .build/site, with every comment
// taken out. site/ keeps its comments for the people working on it; a visitor
// reads only what the page needs.
//
// Scripts and styles are minified with esbuild. The page keeps its layout;
// only its comments go. A licence comment (/*! or @license) stays, as its
// licence requires. Data files are copied as they are. Afterwards every
// served text file is checked by findLeaks(); with --check a hit stops the
// build, and so the publish.
//
//   node scripts/build-public.mjs --check     builds .build/site from site/
//   SITE=.build/site npm run serve            serves the built copy
import { cpSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
export const SOURCE = join(root, "site");
export const OUT = join(root, ".build", "site");

// Every served file that is text, so can hold a comment or a note.
const TEXT = /\.(m?js|css|html|svg|xml|json|txt|webmanifest)$/;

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : [path];
});
const served = (dir) => files(dir).filter((path) => TEXT.test(path));

// No format is set: the page's scripts are classic scripts that share
// top-level names, which esbuild then leaves as they are.
const minify = (code, loader) => transformSync(code, {
  loader, minify: true, target: "esnext", charset: "utf8", legalComments: "inline",
}).code.trim();

// Markup: comments out, but never inside a <script>, <style> or <textarea>,
// whose text is not markup. Inline scripts and styles are minified; JSON
// blocks (structured data, import maps) are left as they are.
const BLOCK = /(<(script|style|textarea)\b([^>]*)>)([\s\S]*?)(<\/\2>)/gi;
const uncomment = (text) => text.replace(/<!--[\s\S]*?-->\n?/g, "");
export function markup(text, minifyBlocks = true) {
  let out = "", last = 0;
  for (const m of text.matchAll(BLOCK)) {
    out += uncomment(text.slice(last, m.index));
    const [all, open, tag, attrs, body, close] = m;
    const kind = tag.toLowerCase();
    if (!minifyBlocks || kind === "textarea" || !body.trim() || (kind === "script" && /type="(application\/(ld\+)?json|importmap)"/i.test(attrs))) out += all;
    else out += open + minify(body, kind === "style" ? "css" : "js") + close;
    last = m.index + all.length;
  }
  return out + uncomment(text.slice(last));
}

export function strip(path, text) {
  if (path.endsWith(".html")) return markup(text, true);
  if (/\.(svg|xml)$/.test(path)) return markup(text, false);
  if (/\.m?js$/.test(path)) return minify(text, "js") + "\n";
  if (path.endsWith(".css")) return minify(text, "css") + "\n";
  return text;
}

export function build(source = SOURCE, out = OUT) {
  rmSync(out, { recursive: true, force: true });
  cpSync(source, out, { recursive: true });
  for (const path of served(out)) writeFileSync(path, strip(path, readFileSync(path, "utf8")));
}

// What must never reach a visitor: a comment of any kind, or the words only
// a comment would hold (notes about decisions, the repository's own folders,
// the machines it is worked on).
const LEAKS = [
  [/<!--/, "an HTML comment"],
  [/\(owner,|owner's word|owner approved/i, "an owner note"],
  [/\b(docs|scripts|test)\/[\w./-]+\.(md|mjs)\b/, "a repository path"],
  [/tailscale|\.ts\.net\b|\/Users\/|\/private\/tmp\//i, "a machine name"],
  [/\b(TODO|FIXME|XXX|hack)\b/i, "a working note"],
];

export function leaksIn(text) {
  const found = LEAKS.map(([pattern, what]) => [pattern.exec(text), what]).filter(([m]) => m);
  // Each block comment on its own: only a licence may stay.
  for (const m of text.matchAll(/\/\*[\s\S]*?\*\//g)) {
    if (!m[0].startsWith("/*!") && !/@license|@preserve/.test(m[0])) { found.push([m, "a block comment"]); break; }
  }
  return found.map(([m, what]) => [m.index, what]);
}

export function findLeaks(dir = OUT) {
  return served(dir).flatMap((path) => {
    const text = readFileSync(path, "utf8");
    return leaksIn(text).map(([i, what]) => `${relative(dir, path)}: ${what}: ${JSON.stringify(text.slice(Math.max(0, i - 30), i + 50))}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  build();
  const leaks = findLeaks();
  console.log(`${relative(root, OUT)}: ${files(OUT).length} files, ${leaks.length} leaks`);
  if (leaks.length) {
    console.error(leaks.join("\n"));
    if (process.argv.includes("--check")) process.exit(1);
  }
}
