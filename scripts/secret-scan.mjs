#!/usr/bin/env node
// Stops an API key or secret from leaving this Mac, in a commit or in a deploy.
//
// The same file is in every TRYX repository (tryx-portal, try-kanali,
// tryx-dna, market-monitor, media-tracker). Change one, copy it to all.
//
//   node scripts/secret-scan.mjs --staged      what git is about to commit (pre-commit hook)
//   node scripts/secret-scan.mjs --tracked     every file git tracks, as it is on disk now
//   node scripts/secret-scan.mjs <path>...     files and folders on disk, untracked ones too
//   --allow-value KEY@path                     the local value of KEY may appear in that one file
//
// Three checks, each reported as file:line without printing the secret:
//   1. Known key formats (Anthropic, OpenAI, AWS, GitHub, Google, Stripe, Slack,
//      X, npm, SendGrid, private keys, passwords inside URLs).
//   2. Any value from this repository's .env, .env.* or .dev.vars that is 16
//      characters or longer. Many keys (GIPHY, Cloudflare) have no prefix to
//      recognise, but they are always in one of these files first.
//   3. A name like key, secret, token or password set to 20+ random-looking
//      characters with both letters and digits.
// A line containing "secret-scan: allow" is skipped (test fixtures only).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp", ".tif", ".tiff", ".heic", ".psd",
  ".mp4", ".mov", ".webm", ".m4v", ".mkv", ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".pdf", ".zip", ".gz", ".tgz", ".7z", ".rar",
  ".glb", ".gltf", ".bin", ".hdr", ".exr", ".ktx2", ".usdz", ".pptx", ".docx", ".xlsx",
  ".db", ".sqlite", ".wasm", ".dylib", ".so", ".node",
]);
const SKIP_DIRS = new Set([".git", "node_modules", ".wrangler", ".DS_Store"]);
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOW_MARK = "secret-scan: allow";

export const PATTERNS = [
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ["OpenAI API key", /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}/g],
  ["Stripe live key", /\b[sr]k_live_[0-9A-Za-z]{20,}/g],
  ["Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
  // A run of A's alone is common in base64 images; a real one is URL-encoded.
  ["X bearer token", /(?<![A-Za-z0-9+/])A{20,24}[A-Za-z0-9%]{20,}%3D[A-Za-z0-9]{20,}/g],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/g],
  ["SendGrid key", /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY[A-Z ]*-----[ \t]*\r?\n[ \t]*(?:[A-Za-z0-9-]+:[^\n]*\n\s*)*[A-Za-z0-9+/=]{40,}/g],
  ["password in a URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/'"`]+:[^\s@/'"`$]{8,}@[^\s'"`]/g],
];

const NAMED = /\b[A-Za-z0-9_]*(?:api[_-]?key|apikey|secret|token|passwd|password|client[_-]?secret|access[_-]?key)[A-Za-z0-9_]*["']?\s*[:=]\s*["'`]([^"'`\s]{20,})["'`]/gi;
const PLACEHOLDER = /test|example|dummy|fake|placeholder|sample|changeme|your|xxxx|redacted|stub/i;

function entropy(s) {
  const n = {};
  for (const c of s) n[c] = (n[c] || 0) + 1;
  return Object.values(n).reduce((h, k) => h - (k / s.length) * Math.log2(k / s.length), 0);
}

function randomLooking(v) {
  return /[A-Za-z]/.test(v) && /[0-9]/.test(v) && !/[/\\${}()<>]/.test(v)
    && !PLACEHOLDER.test(v) && entropy(v) >= 3.5;
}

function git(args, cwd, opts = {}) {
  return execFileSync("git", args, { cwd, maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"], ...opts });
}

export function repoRoots(cwd) {
  try {
    const top = git(["rev-parse", "--show-toplevel"], cwd, { encoding: "utf8" }).trim();
    const common = resolve(top, git(["rev-parse", "--git-common-dir"], top, { encoding: "utf8" }).trim());
    return [...new Set([top, dirname(common)])];
  } catch {
    return [resolve(cwd)];
  }
}

function parseEnv(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out.push([m[1], v]);
  }
  return out;
}

// Values from the local secret files. A worktree has none of its own, so the
// shared folder's files are read too.
export function localSecrets(roots) {
  const secrets = new Map();
  const harmless = new Set();
  for (const root of roots) {
    let names = [];
    try { names = readdirSync(root); } catch { continue; }
    for (const name of names) {
      const isExample = /\.example$|\.sample$|\.template$/.test(name);
      if (!/^\.env(\..+)?$|^\.dev\.vars(\..+)?$/.test(name)) continue;
      let text;
      try { text = readFileSync(join(root, name), "utf8"); } catch { continue; }
      for (const [k, v] of parseEnv(text)) {
        if (isExample) { harmless.add(v); continue; }
        if (v.length < 16 || /\s/.test(v)) continue;
        if (/^(https?:\/\/[^@\s]*|[/~].*)$/.test(v)) continue; // a plain address or a path
        if (/^(true|false|production|development)$/i.test(v)) continue;
        if (!secrets.has(v)) secrets.set(v, k);
      }
    }
  }
  for (const v of harmless) secrets.delete(v);
  return secrets;
}

function lineOf(text, index) {
  let n = 1;
  for (let i = text.indexOf("\n"); i !== -1 && i < index; i = text.indexOf("\n", i + 1)) n++;
  return n;
}

function lineAt(text, index) {
  const s = text.lastIndexOf("\n", index - 1) + 1;
  const e = text.indexOf("\n", index);
  return text.slice(s, e === -1 ? text.length : e);
}

function mask(v) {
  return `${v.slice(0, 4)}... (${v.length} characters)`;
}

// Findings for one file's text. `allowed` holds the env keys whose value may
// appear in this file.
export function scanText(file, text, secrets = new Map(), allowed = new Set()) {
  const found = [];
  const add = (index, what, value, shown = mask(value)) => {
    if (lineAt(text, index).includes(ALLOW_MARK)) return;
    found.push({ file, line: lineOf(text, index), what, value: shown });
  };
  for (const [what, re] of PATTERNS) {
    for (const m of text.matchAll(re)) add(m.index, what, m[0]);
  }
  for (const [value, key] of secrets) {
    if (allowed.has(key)) continue;
    for (let i = text.indexOf(value); i !== -1; i = text.indexOf(value, i + value.length)) {
      // Not even the start of a real value is printed: deploy output is logged.
      add(i, `the value of ${key} from the local secret file`, value, `${value.length} characters`);
    }
  }
  for (const m of text.matchAll(NAMED)) {
    if (randomLooking(m[1])) add(m.index, "a hard-coded secret", m[1]);
  }
  const seen = new Set();
  return found.filter((f) => {
    const k = `${f.line}:${f.what}`;
    return seen.has(k) ? false : seen.add(k);
  });
}

function decode(buf) {
  if (buf.length > MAX_BYTES) return null;
  if (buf.subarray(0, 8000).includes(0)) return null; // binary
  return buf.toString("utf8");
}

const skippable = (p) => SKIP_EXT.has(extname(p).toLowerCase());

function walk(path, out) {
  let st;
  try { st = statSync(path); } catch { return; }
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) if (!SKIP_DIRS.has(name)) walk(join(path, name), out);
  } else if (st.isFile() && st.size <= MAX_BYTES && !skippable(path)) {
    out.push(path);
  }
}

function parseAllow(list) {
  const allow = new Map();
  for (const a of list) {
    const at = a.indexOf("@");
    if (at < 1) throw new Error(`--allow-value takes KEY@path, got "${a}"`);
    const path = a.slice(at + 1).split(sep).join("/");
    if (!allow.has(path)) allow.set(path, new Set());
    allow.get(path).add(a.slice(0, at));
  }
  return allow;
}

// Returns the findings; prints nothing.
export function scan({ cwd = process.cwd(), staged = false, tracked = false, paths = [], allowValues = [] } = {}) {
  const roots = repoRoots(cwd);
  const top = roots[0];
  const secrets = localSecrets(roots);
  const allow = parseAllow(allowValues);
  const files = []; // [displayPath, () => text | null]

  if (staged) {
    const names = git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"], top, { encoding: "utf8" })
      .split("\0").filter(Boolean);
    for (const name of names) {
      if (skippable(name)) continue;
      files.push([name, () => decode(git(["show", `:${name}`], top))]);
    }
  }
  if (tracked) {
    for (const name of git(["ls-files", "-z"], top, { encoding: "utf8" }).split("\0").filter(Boolean)) {
      const full = join(top, name);
      if (skippable(name) || !existsSync(full)) continue;
      files.push([name, () => (statSync(full).isFile() ? decode(readFileSync(full)) : null)]);
    }
  }
  for (const p of paths) {
    const list = [];
    const start = resolve(cwd, p);
    walk(existsSync(start) ? realpathSync(start) : start, list);
    for (const full of list) files.push([relative(top, full).split(sep).join("/"), () => decode(readFileSync(full))]);
  }

  const findings = [];
  for (const [name, read] of files) {
    const text = read();
    if (text == null) continue;
    findings.push(...scanText(name, text, secrets, allow.get(name) || new Set()));
  }
  return findings;
}

export function report(findings, where) {
  if (!findings.length) return "";
  const lines = findings.map((f) => `  ${f.file}:${f.line}  ${f.what}: ${f.value}`);
  return [
    `BLOCKED: ${findings.length === 1 ? "a secret" : `${findings.length} secrets`} would leave this Mac ${where}.`,
    ...lines,
    "Keys belong in .env, .dev.vars or the server's secret store, never in a file that is committed or deployed.",
    `A test fixture that only looks like a key can carry "${ALLOW_MARK}" on its line.`,
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opts = { staged: false, tracked: false, paths: [], allowValues: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--staged") opts.staged = true;
    else if (args[i] === "--tracked") opts.tracked = true;
    else if (args[i] === "--allow-value") opts.allowValues.push(args[++i] || "");
    else opts.paths.push(args[i]);
  }
  if (!opts.staged && !opts.tracked && !opts.paths.length) {
    console.error("Usage: node scripts/secret-scan.mjs --staged | --tracked | <path>... [--allow-value KEY@path]");
    process.exit(2);
  }
  let findings;
  try {
    findings = scan(opts);
  } catch (e) {
    console.error(`secret-scan could not run: ${e.message}`);
    process.exit(2);
  }
  if (findings.length) {
    console.error(report(findings, opts.staged ? "in this commit" : "in this deploy"));
    process.exit(1);
  }
}
