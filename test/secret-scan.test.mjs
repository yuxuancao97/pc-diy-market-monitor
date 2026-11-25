// Tests scripts/secret-scan.mjs, the check that stops keys leaving this Mac.
// The same file is in every TRYX repository; change one, copy it to all.
// Fixtures are built from pieces so this file never looks like a key itself.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SCANNER = [join(here, "secret-scan.mjs"), join(here, "..", "scripts", "secret-scan.mjs")].find(existsSync);
const { scanText, scan } = await import(SCANNER);

const r = (n, chars = "aB3dE5gH7jK9mN1pQ2sT4vW6xY8zC0") => Array.from({ length: n }, (_, i) => chars[(i * 7 + 3) % chars.length]).join("");
let passed = 0;
const test = (name, fn) => { fn(); passed++; };

test("known key formats are caught", () => {
  const samples = {
    "Anthropic API key": "sk-" + "ant-api03-" + r(40),
    "OpenAI API key": "sk-" + "proj-" + r(48),
    "AWS access key": "AK" + "IA" + "ABCDEFGHIJKLMNOP",
    "GitHub token": "gh" + "p_" + r(36),
    "Google API key": "AI" + "za" + r(35),
    "Stripe live key": "sk" + "_live_" + r(24),
    "Slack token": "xo" + "xb-" + "1234567890-" + r(20),
    "X bearer token": "A".repeat(22) + r(24) + "%3D" + r(40),
    "npm token": "np" + "m_" + r(36),
    "SendGrid key": "S" + "G." + r(22) + "." + r(43),
    "private key": "-----BEGIN " + "RSA PRIVATE KEY-----\n" + r(64, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/") + "\n",
    "password in a URL": "postgres://admin:" + r(16) + "@db.internal:5432/app",
  };
  for (const [what, value] of Object.entries(samples)) {
    const found = scanText("f.js", `const x = "${value}";\n`);
    assert.ok(found.some((f) => f.what === what), `${what} was not caught`);
  }
});

test("look-alikes that are not keys pass", () => {
  const harmless = [
    "-----BEGIN " + "OPENSSH PRIVATE KEY-----\nstub\n",
    "-----BEGIN " + "OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----\n",
    "url(data:image/png;base64,iVBOR" + "A".repeat(60) + "Q2CYII=)",
    'process.env.ADMIN_PASSWORD = "wip-review-test-admin";',
    'const token = "' + "not-a-random-looking-value-at-all" + '";',
    'apiKey: process.env.GIPHY_API_KEY',
    "class=\"task-" + r(40) + "\"",
    "https://trykanali.com/x/result",
  ];
  for (const text of harmless) assert.deepEqual(scanText("f.js", text), [], `flagged: ${text.slice(0, 50)}`);
});

test("a random-looking value under a secret-like name is caught", () => {
  const found = scanText("f.js", `const clientSecret = "${r(32)}";`);
  assert.equal(found[0]?.what, "a hard-coded secret");
});

test("the allow mark skips its own line only", () => {
  const key = "gh" + "p_" + r(36);
  assert.deepEqual(scanText("f.js", `"${key}" // secret-` + "scan: allow"), []);
  assert.equal(scanText("f.js", `"${key}" // secret-` + "scan: allow\n" + `"${key}"`).length, 1);
});

test("the report never prints the secret", () => {
  const key = "gh" + "p_" + r(36);
  const [f] = scanText("f.js", key);
  assert.ok(!f.value.includes(key) && f.value.length < 30);
});

// A throwaway repository with a local secret file, like a real checkout.
const repo = mkdtempSync(join(tmpdir(), "secret-scan-test-"));
const sh = (...a) => execFileSync("git", a, { cwd: repo, stdio: "pipe" });
try {
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "t@t"); sh("config", "user.name", "t");
  const giphy = r(32, "qwertyuiopASDFGHJKLzxcvbnm0123456789");
  writeFileSync(join(repo, ".dev.vars"), `GIPHY_API_KEY=${giphy}\nSITE_ORIGIN=https://trykanali.com/\nSHORT=abc\n`);
  writeFileSync(join(repo, ".env"), `PUBLIC_NAME=a-name-that-is-in-the-example\n`);
  writeFileSync(join(repo, ".env.example"), `PUBLIC_NAME=a-name-that-is-in-the-example\n`);
  mkdirSync(join(repo, "public"));
  writeFileSync(join(repo, "public", "config.js"), `meta("giphy-key", "${giphy}")\n`);
  writeFileSync(join(repo, "public", "page.html"), `<a href="https://trykanali.com/">a-name-that-is-in-the-example</a>\n`);
  writeFileSync(join(repo, "public", "picture.png"), giphy);

  test("a value from .dev.vars is caught in a file about to deploy, even untracked", () => {
    const found = scan({ cwd: repo, paths: ["public"] });
    assert.equal(found.length, 1);
    assert.equal(found[0].file, "public/config.js");
    assert.match(found[0].what, /GIPHY_API_KEY/);
  });

  test("--allow-value exempts one key in one file", () => {
    assert.deepEqual(scan({ cwd: repo, paths: ["public"], allowValues: ["GIPHY_API_KEY@public/config.js"] }), []);
    writeFileSync(join(repo, "public", "other.js"), giphy);
    assert.equal(scan({ cwd: repo, paths: ["public"], allowValues: ["GIPHY_API_KEY@public/config.js"] }).length, 1);
    rmSync(join(repo, "public", "other.js"));
  });

  test("--staged reads what is staged, not the file on disk", () => {
    writeFileSync(join(repo, "app.js"), `const k = "${giphy}";\n`);
    sh("add", "app.js");
    writeFileSync(join(repo, "app.js"), "const k = process.env.GIPHY_API_KEY;\n");
    assert.equal(scan({ cwd: repo, staged: true }).length, 1);
    sh("add", "app.js");
    assert.deepEqual(scan({ cwd: repo, staged: true }), []);
  });

  test("a worktree reads the shared folder's secret files", () => {
    sh("commit", "-qm", "start");
    const wt = join(repo, "wt");
    sh("worktree", "add", "-q", "-b", "task", wt);
    writeFileSync(join(wt, "leak.js"), giphy);
    assert.equal(scan({ cwd: wt, paths: ["leak.js"] }).length, 1);
  });

  test("the command exits 1 with a report, 0 when clean", () => {
    const bad = spawnSync(process.execPath, [SCANNER, "public"], { cwd: repo, encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /BLOCKED/);
    assert.ok(!bad.stderr.includes(giphy), "the report printed the key");
    const ok = spawnSync(process.execPath, [SCANNER, "public", "--allow-value", "GIPHY_API_KEY@public/config.js"], { cwd: repo, encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
  });
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log(`secret-scan: ${passed} checks passed`);
