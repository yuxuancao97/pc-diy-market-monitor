#!/usr/bin/env node
// Tries every way a merge or deploy has rolled work back, in throwaway
// repositories, and checks scripts/main-guard.mjs stops each one.
//   npm run test:guard
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = join(import.meta.dirname, "..");
const root = mkdtempSync(join(tmpdir(), "main-guard-test-"));
const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null", TRYX_ROLLBACK: "", TRYX_MAIN_TOKEN: "" };
for (const key of Object.keys(env)) if (key.startsWith("GIT_") && !key.startsWith("GIT_AUTHOR") && !key.startsWith("GIT_COMMITTER") && key !== "GIT_CONFIG_GLOBAL") delete env[key];
const run = (cwd, cmd, args, extra = {}) => spawnSync(cmd, args, { cwd, env: { ...env, ...extra }, encoding: "utf8" });
const git = (cwd, ...args) => { const r = run(cwd, "git", args); if (r.status) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return r.stdout.trim(); };
let failures = 0, passes = 0;
const check = (name, ok, detail = "") => { if (ok) passes++; else { failures++; console.error(`FAIL ${name}${detail ? `\n${detail}` : ""}`); } };

// A shared folder like try-kanali's: main, the hooks, the scripts, a test
// that fails while a file named FAIL is present, and a stand-in deploy.
const origin = join(root, "origin.git");
git(root, "init", "--bare", "-b", "main", origin);
const shared = join(root, "shared");
git(root, "clone", "-q", origin, shared);
git(shared, "checkout", "-q", "-b", "main");
mkdirSync(join(shared, "scripts"));
for (const file of ["main-guard.mjs", "worktree.mjs"]) cpSync(join(here, "scripts", file), join(shared, "scripts", file));
cpSync(join(here, ".githooks"), join(shared, ".githooks"), { recursive: true });
writeFileSync(join(shared, "package.json"), JSON.stringify({ type: "module", scripts: {
  test: "node -e \"process.exit(require('fs').existsSync('FAIL') ? 1 : 0)\"",
  worktree: "node scripts/worktree.mjs",
  deploy: "node scripts/main-guard.mjs deploy -- sh -c 'echo $TRYX_DEPLOY_COMMIT > ../deployed.txt'",
} }, null, 2));
writeFileSync(join(shared, ".gitignore"), ".claude/worktrees/\n");
writeFileSync(join(shared, "page.css"), ".a{color:red}\n.b{color:blue}\n.c{color:green}\n");
git(shared, "add", ".");
git(shared, "commit", "-q", "-m", "start");
git(shared, "push", "-q", "-u", "origin", "main");
git(shared, "config", "core.hooksPath", ".githooks");

const worktree = (args, extra) => run(shared, "node", ["scripts/worktree.mjs", ...args], extra);
const wt = name => join(shared, ".claude", "worktrees", name);
const newBranch = name => { const r = worktree(["new", `claude/${name}`]); if (r.status) throw new Error(r.stderr); return wt(name); };
const edit = (dir, file, from, to) => writeFileSync(join(dir, file), readFileSync(join(dir, file), "utf8").replace(from, to));
const commit = (dir, message) => { git(dir, "add", "-A"); return run(dir, "git", ["commit", "-q", "-m", message]); };
const mainSha = () => git(shared, "rev-parse", "main");

// 1. Two chats start from the same main. A merges first.
const a = newBranch("a"), b = newBranch("b");
edit(a, "page.css", ".a{color:red}", ".a{color:red;transition:opacity .8s}");
check("a commits", commit(a, "a's change").status === 0);
let r = worktree(["merge", "claude/a", "a's change"]);
check("a merges cleanly", r.status === 0, r.stderr);
check("the shared folder has a's change", readFileSync(join(shared, "page.css"), "utf8").includes("transition"));
check("the merge records the owner's approval", git(shared, "log", "-1", "--format=%s").startsWith("Merge a's change (owner approved"));
check("the merge is a real merge", git(shared, "rev-list", "--parents", "-1", "main").split(" ").length === 3);

// 2. B edits its old copy, brings main in, then copies its old file back
// over main's (the rollback by hand). The merge stops and names the line.
edit(b, "page.css", ".c{color:green}", ".c{color:teal}");
commit(b, "b's change");
git(b, "merge", "-q", "--no-edit", "main");
const before = readFileSync(join(b, "page.css"), "utf8");
writeFileSync(join(b, "page.css"), before.replace(";transition:opacity .8s", ""));
commit(b, "b tidies page.css");
r = worktree(["check", "claude/b"]);
check("check names the dropped line", r.stdout.includes("transition:opacity"), r.stdout + r.stderr);
const held = mainSha();
r = worktree(["merge", "claude/b", "b's change"]);
check("a merge that drops main's line is refused", r.status !== 0 && r.stderr.includes("transition:opacity"), r.stderr);
check("main is unchanged after the refusal", mainSha() === held);
check("the lock is let go after a refusal", !existsSync(join(shared, ".git", "tryx-main.lock")));
r = worktree(["merge", "claude/b", "b's change", "--drops", "a's transition, the owner asked for it gone"]);
check("--drops lets a deliberate removal through", r.status === 0, r.stderr);
check("the reason is in the merge message", git(shared, "log", "-1", "--format=%B").includes("Drops: a's transition, the owner asked for it gone"));

// 3. A conflict resolved by keeping one side whole: the commit is refused.
const c = newBranch("c"), d = newBranch("d");
edit(c, "page.css", ".b{color:blue}", ".b{color:navy}");
commit(c, "c's change");
check("c merges", worktree(["merge", "claude/c", "c's change"]).status === 0);
edit(d, "page.css", ".b{color:blue}", ".b{color:black}");
commit(d, "d's change");
check("bringing main into d conflicts", run(d, "git", ["merge", "main"]).status !== 0);
git(d, "checkout", "--ours", "page.css");
git(d, "add", "page.css");
r = run(d, "git", ["commit", "--no-edit"]);
check("committing a conflict resolution that drops main's line is refused", r.status !== 0 && r.stderr.includes("color:navy"), r.stderr);
r = run(d, "git", ["commit", "-m", "Bring main in\n\nDrops: c's navy, d's black is the owner's pick"]);
check("a Drops: line lets it through", r.status === 0, r.stderr);

// 4. A clean "bring main in" is not bothered.
const e = newBranch("e");
writeFileSync(join(e, "new.js"), "export const e = 1;\n");
commit(e, "e's file");
const f = newBranch("f");
writeFileSync(join(f, "other.js"), "export const f = 1;\n");
commit(f, "f's file");
check("e merges", worktree(["merge", "claude/e", "e's file"]).status === 0);
check("a clean bring-main-in commits", run(f, "git", ["merge", "--no-edit", "main"]).status === 0);

// 5. Failing tests leave main and the shared folder alone.
writeFileSync(join(f, "FAIL"), "");
commit(f, "breaks the tests");
const atFail = mainSha();
r = worktree(["merge", "claude/f", "f's file"]);
check("failing tests refuse the merge", r.status !== 0);
check("main is unchanged after failing tests", mainSha() === atFail);
check("the shared folder is clean after failing tests", git(shared, "status", "--porcelain") === "" && !existsSync(join(shared, ".git", "MERGE_HEAD")));
rmSync(join(f, "FAIL"));
commit(f, "fixes the tests");

// 6. main moved by hand in the shared folder is refused and put back.
const atHand = mainSha();
r = run(shared, "git", ["merge", "--ff-only", "claude/f"]);
check("a fast-forward by hand is refused", r.status !== 0 && /merge command/.test(r.stderr), r.stderr);
check("main did not move", mainSha() === atHand);
check("the shared folder's files are put back", git(shared, "status", "--porcelain") === "" && !existsSync(join(shared, "other.js")), git(shared, "status", "--porcelain"));
r = run(shared, "git", ["merge", "--no-ff", "--no-edit", "claude/f"]);
check("a merge commit by hand is refused", r.status !== 0 && mainSha() === atHand, r.stderr);
run(shared, "git", ["merge", "--abort"]);
run(shared, "git", ["reset", "-q", "--hard", "main"]);
check("git branch -f main is refused", run(shared, "git", ["branch", "-f", "main", "claude/f"]).status !== 0 || mainSha() === atHand);
check("update-ref is refused", run(shared, "git", ["update-ref", "refs/heads/main", git(shared, "rev-parse", "claude/f")]).status !== 0 && mainSha() === atHand);
check("a commit in the shared folder is refused", (writeFileSync(join(shared, "x.txt"), "x"), commit(shared, "direct")).status !== 0);
rmSync(join(shared, "x.txt"));
git(shared, "reset", "-q");

// 7. The lock: a live holder refuses, a dead one is cleared.
const lock = join(shared, ".git", "tryx-main.lock");
mkdirSync(lock);
writeFileSync(join(lock, "owner.json"), JSON.stringify({ what: "a deploy", pid: process.pid, host: (await import("node:os")).hostname(), since: "now", token: "x" }));
r = worktree(["merge", "claude/f", "f's file"]);
check("a merge waits for a deploy in progress", r.status !== 0 && r.stderr.includes("main is busy: a deploy"), r.stderr);
writeFileSync(join(lock, "owner.json"), JSON.stringify({ what: "a deploy", pid: 999999, host: (await import("node:os")).hostname(), since: "then", token: "x" }));
r = worktree(["merge", "claude/f", "f's file"]);
check("a dead holder's lock is cleared", r.status === 0, r.stderr);

// 8. The deploy ships main, from the shared folder, never behind the last one.
r = run(f, "npm", ["run", "-s", "deploy"]);
check("a deploy from a worktree is refused", r.status !== 0 && r.stderr.includes("shared folder"), r.stderr);
writeFileSync(join(shared, "stray.txt"), "x");
r = run(shared, "npm", ["run", "-s", "deploy"]);
check("a deploy with stray files is refused", r.status !== 0 && r.stderr.includes("stray.txt"), r.stderr);
rmSync(join(shared, "stray.txt"));
r = run(shared, "npm", ["run", "-s", "deploy"]);
check("a clean deploy runs", r.status === 0, r.stderr);
check("the deploy is told its commit", readFileSync(join(root, "deployed.txt"), "utf8").trim() === mainSha().slice(0, 12));
check("the deploy is recorded", git(shared, "rev-parse", "refs/tryx/deployed") === mainSha());
git(shared, "update-ref", "refs/tryx/deployed", git(shared, "rev-parse", "claude/d"));
r = run(shared, "npm", ["run", "-s", "deploy"]);
check("a deploy that would take work off the live site is refused", r.status !== 0 && r.stderr.includes("not in main"), r.stderr);
r = run(shared, "npm", ["run", "-s", "deploy"], { TRYX_ROLLBACK: "1" });
check("TRYX_ROLLBACK=1 lets an asked-for rollback through", r.status === 0, r.stderr);

// 9. GitHub: catching up is allowed, a push that drops its commits is not.
check("main is pushed", run(shared, "git", ["push", "-q", "origin", "main"]).status === 0);
const other = join(root, "other");
git(root, "clone", "-q", origin, other);
writeFileSync(join(other, "yuxuan.txt"), "from GitHub\n");
git(other, "add", "."); git(other, "commit", "-q", "-m", "merged on GitHub"); git(other, "push", "-q", "origin", "main");
git(shared, "fetch", "-q", "origin");
r = run(shared, "git", ["merge", "--ff-only", "origin/main"]);
check("main may catch up with GitHub's main", r.status === 0, r.stderr);
git(other, "commit", "-q", "--allow-empty", "-m", "another on GitHub"); git(other, "push", "-q", "origin", "main");
git(shared, "fetch", "-q", "origin");
r = run(shared, "git", ["push", "--force", "origin", "main"]);
check("a force push that drops GitHub's commits is refused", r.status !== 0 && r.stderr.includes("would drop commits"), r.stderr);

rmSync(root, { recursive: true, force: true });
console.log(`main-guard: ${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
