#!/usr/bin/env node
// Keeps merges and deploys from rolling back each other's work.
// The same file is in every TRYX repository with a shared folder (try-kanali,
// market-monitor, tryx-dna); keep the copies identical.
//
// What went wrong before (Try KANALI, 2026-11-20): `worktree -- merge` left
// the shared folder half-merged for its whole test run, and two chats ran
// their merges there at the same moment; one merge had to be undone.
//
// Four rules, each enforced here:
// 1. One thing changes main at a time: merges and deploys take one lock.
// 2. The shared folder is never half-merged: the merge is tested in the
//    branch's own worktree and main then moves in one step.
// 3. A merge never quietly throws away lines main gained while the branch
//    was away. It lists them and stops; a deliberate removal says why, and
//    the reason goes into the merge message ("Drops: ...").
// 4. A deploy ships main exactly, never a branch, a dirty folder or anything
//    older than the last deploy; a push never drops commits GitHub has.
//
//   node scripts/main-guard.mjs dropped <branch>          what merging it would throw away
//   node scripts/main-guard.mjs deploy -- <command ...>   run the deploy under the rules
//   node scripts/main-guard.mjs merge-message <file>      commit-msg hook
//   node scripts/main-guard.mjs main-update <phase> <pid> reference-transaction hook
//   node scripts/main-guard.mjs push                      pre-push hook (refs on stdin)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

// Hooks run with GIT_DIR and friends pointing at one worktree; every call
// here names its folder instead.
const env = { ...process.env };
for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete env[key];

export const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 }).trimEnd();
const ok = (cwd, ...args) => spawnSync("git", ["-C", cwd, ...args], { env, stdio: "ignore" }).status === 0;
const ZERO = /^0+$/;

// The shared folder is the repository's first worktree.
export function sharedFolder(cwd = process.cwd()) {
  return dirname(resolve(cwd, git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")));
}
const isAncestor = (cwd, older, newer) => ok(cwd, "merge-base", "--is-ancestor", older, newer);

// ---------------------------------------------------------------- the lock
// A folder in the git directory, made atomically. It names its holder; one
// whose process is gone (on this Mac) holds nothing.
const lockDir = cwd => join(resolve(cwd, git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")), "tryx-main.lock");

function readLock(dir) {
  try { return JSON.parse(readFileSync(join(dir, "owner.json"), "utf8")); } catch { return null; }
}
function alive(owner) {
  if (!owner || owner.host !== hostname()) return Boolean(owner);
  try { process.kill(owner.pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

export function withLock(cwd, what, fn) {
  const dir = lockDir(cwd);
  for (let attempt = 0; ; attempt++) {
    try { mkdirSync(dir); break; } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = readLock(dir);
      // A folder with no owner yet is a lock being taken this instant.
      if (attempt < 3 && (!owner || !alive(owner))) {
        if (owner || Date.now() - safeMtime(dir) > 10_000) rmSync(dir, { recursive: true, force: true });
        else spawnSync("sleep", ["1"]);
        continue;
      }
      throw new GuardError(`main is busy: ${owner ? `${owner.what}, since ${owner.since} (process ${owner.pid})` : "a lock is being taken"}.\nNothing was changed. Wait for it to finish, then run this again.`);
    }
  }
  const token = randomUUID();
  writeFileSync(join(dir, "owner.json"), JSON.stringify({ what, pid: process.pid, host: hostname(), since: new Date().toISOString(), token }));
  const release = () => { if (readLock(dir)?.token === token) rmSync(dir, { recursive: true, force: true }); };
  const onSignal = signal => { release(); process.exit(signal === "SIGINT" ? 130 : 143); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try { return fn(token); } finally {
    release();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
function safeMtime(dir) { try { return execFileSync("stat", ["-f", "%m", dir], { encoding: "utf8" }) * 1000; } catch { return 0; } }

// ------------------------------------------------------ lines thrown away
// Where the branch left main: the first commit on its own line (first
// parents) that main already has. "Bring main in" merges keep the branch on
// its first-parent line, so they are walked through, not mistaken for it.
export function forkPoint(cwd, branch, main = "main") {
  for (const commit of git(cwd, "rev-list", "--first-parent", branch).split("\n")) {
    if (isAncestor(cwd, commit, main)) return commit;
  }
  return null;
}

// Lines that `gained` has and `base` lacks, per file, which `result` does not
// have anywhere in that file. Lines are compared without their indentation,
// and blank lines and lone brackets are left out: they match anywhere.
export function droppedLines(cwd, base, gained, result) {
  const lost = new Map();
  const diff = git(cwd, "-c", "core.quotePath=false", "diff", "--no-renames", "--no-ext-diff", "--no-color", "-U0", base, gained);
  let file = null, added = [];
  const flush = () => {
    if (!file || !added.length) return;
    const text = blob(cwd, result, file);
    const have = new Set(text === null ? [] : text.split("\n").map(line => line.trim()));
    const missing = [...new Set(added)].filter(line => !have.has(line));
    if (missing.length) lost.set(file, { missing, deleted: text === null });
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) { flush(); file = null; added = []; continue; }
    // Git ends a name that has a space with a tab, and quotes an odd one.
    if (line.startsWith("+++ ")) { file = line === "+++ /dev/null" ? null : unquote(line.slice(4).replace(/\t$/, "")).slice(2); continue; }
    if (line.startsWith("Binary files ") && line.includes(" and b/")) {
      const name = line.slice(line.indexOf(" and b/") + 7, -" differ".length);
      if (blob(cwd, gained, name) !== null && git(cwd, "rev-parse", `${gained}:${name}`) !== revParseOrNull(cwd, `${result}:${name}`)) lost.set(name, { missing: ["(binary file)"], deleted: revParseOrNull(cwd, `${result}:${name}`) === null });
      continue;
    }
    if (file && line.startsWith("+") && !line.startsWith("+++")) {
      const text = line.slice(1).trim();
      if (text.length > 2) added.push(text);
    }
  }
  flush();
  return lost;
}
function unquote(name) {
  if (!name.startsWith('"')) return name;
  const bytes = [];
  for (let i = 1; i < name.length - 1; i++) {
    if (name[i] !== "\\") { bytes.push(...Buffer.from(name[i])); continue; }
    const next = name[++i];
    if (/[0-7]/.test(next)) { bytes.push(parseInt(name.slice(i, i + 3), 8)); i += 2; }
    else bytes.push({ n: 10, t: 9, '"': 34, "\\": 92 }[next] ?? next.charCodeAt(0));
  }
  return Buffer.from(bytes).toString("utf8");
}
function revParseOrNull(cwd, spec) { try { return git(cwd, "rev-parse", "-q", "--verify", spec); } catch { return null; } }
function blob(cwd, commit, file) {
  const r = spawnSync("git", ["-C", cwd, "show", commit === ":" ? `:${file}` : `${commit}:${file}`], { env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

// What merging `branch` into main would throw away of main's own work since
// the branch left it. The merge result is the branch's own tree, since a
// branch must hold current main before it merges.
export function droppedByMerge(cwd, branch, main = "main") {
  const fork = forkPoint(cwd, branch, main);
  if (!fork) return new Map();
  return droppedLines(cwd, fork, main, branch);
}

export function describeDropped(cwd, lost, since, until) {
  const out = [];
  for (const [file, { missing, deleted }] of lost) {
    const by = since ? git(cwd, "log", "--first-parent", "--format=%h %s", `${since}..${until}`, "--", file).split("\n").filter(Boolean).slice(0, 3) : [];
    out.push(`  ${file}${deleted ? " (the file is gone)" : ""}${by.length ? `\n    from: ${by.join("\n          ")}` : ""}`);
    for (const line of missing.slice(0, 6)) out.push(`    - ${line.length > 110 ? line.slice(0, 107) + "..." : line}`);
    if (missing.length > 6) out.push(`    ... and ${missing.length - 6} more`);
  }
  return out.join("\n");
}

// ------------------------------------------------------------- the hooks
// commit-msg, while a merge is being committed (a "bring main in" whose
// conflicts were resolved by hand, or a clean one): every line either side
// gained must survive, unless the message says what was dropped and why.
function guardMergeMessage(messageFile) {
  const cwd = process.cwd();
  const mergeHead = join(git(cwd, "rev-parse", "--path-format=absolute", "--git-dir"), "MERGE_HEAD");
  if (!existsSync(mergeHead)) return;
  if (/^Drops: \S/m.test(readFileSync(messageFile, "utf8"))) return;
  const theirs = readFileSync(mergeHead, "utf8").trim().split("\n")[0];
  const base = git(cwd, "merge-base", "HEAD", theirs);
  const lost = [];
  for (const [side, tip] of [["the branch being merged in", theirs], ["this branch", "HEAD"]]) {
    const dropped = droppedLines(cwd, base, tip, ":");
    if (dropped.size) lost.push(`Lines ${side} added that this merge leaves out:\n${describeDropped(cwd, dropped, base, tip)}`);
  }
  if (!lost.length) return;
  throw new GuardError(`${lost.join("\n\n")}\n\nThis is how a merge rolls back someone's work. Put them back (git checkout --merge <file> redoes the conflict),\nor, if leaving them out is deliberate, add a line to the commit message: Drops: <what and why>`);
}

// reference-transaction: main moves only under the lock (the merge command
// sets TRYX_MAIN_TOKEN), or forward to exactly GitHub's main.
function guardMainUpdate(phase, gitPid) {
  const lines = readFileSync(0, "utf8").trim().split("\n").filter(Boolean).map(line => line.split(" "));
  const cwd = process.cwd();
  const shared = sharedFolder(cwd);
  if (phase === "aborted") return restoreRefusedCheckout(shared, lines);
  if (phase !== "prepared") return;
  for (let [oldCommit, newCommit, ref] of lines) {
    if (ref !== "refs/heads/main") continue;
    // update-ref and branch -f/-D name no expected old value: zeros. main
    // still holds its current commit while this phase runs.
    if (ZERO.test(oldCommit)) oldCommit = revParseOrNull(cwd, "refs/heads/main") ?? oldCommit;
    if (oldCommit === newCommit || ZERO.test(oldCommit)) continue;
    if (ZERO.test(newCommit)) {
      // pack-refs moves main into packed-refs at the same commit and then
      // deletes the loose file: housekeeping, but only from pack-refs itself.
      if (isPackRefs(gitPid) && packedMain(cwd) === oldCommit) continue;
      throw new GuardError("Do not delete main.");
    }
    const owner = readLock(lockDir(cwd));
    if (owner && process.env.TRYX_MAIN_TOKEN && owner.token === process.env.TRYX_MAIN_TOKEN) continue;
    const remote = revParseOrNull(shared, "refs/remotes/origin/main");
    if (newCommit === remote && isAncestor(shared, oldCommit, newCommit)) continue;
    throw new GuardError("main moves only through the merge command (npm run worktree -- merge <branch> \"<what>\"),\nwhich tests the branch first and checks it drops nothing main gained. Nothing was changed.");
  }
}

// A fast-forward writes the new files into the folder before it asks to move
// main, so a refusal would leave them there for the next deploy to ship
// (tryx-portal, 2026-10-30). Put the folder back when main stayed put.
function restoreRefusedCheckout(shared, lines) {
  for (const [oldCommit, newCommit, ref] of lines) {
    if (ref !== "refs/heads/main" || oldCommit === newCommit || ZERO.test(oldCommit) || ZERO.test(newCommit)) continue;
    if (revParseOrNull(shared, "HEAD") !== oldCommit || spawnSync("git", ["-C", shared, "symbolic-ref", "-q", "HEAD"], { env, encoding: "utf8" }).stdout.trim() !== "refs/heads/main") continue;
    const back = spawnSync("git", ["-C", shared, "read-tree", "-m", "-u", newCommit, oldCommit], { env, encoding: "utf8" });
    if (back.status !== 0) { console.error(`main was not moved, but the folder could not be put back:\n${back.stderr.trim()}\nCheck git status before anyone deploys from it.`); continue; }
    // A refused merge commit by hand would leave a merge in progress, and
    // every later merge and deploy would stop on it.
    const gitDir = git(shared, "rev-parse", "--path-format=absolute", "--git-dir");
    for (const file of ["MERGE_HEAD", "MERGE_MSG", "MERGE_MODE", "AUTO_MERGE"]) rmSync(join(gitDir, file), { force: true });
    console.error("main was not moved, and the files the refused update had written are back as they were.");
  }
}
// gc and maintenance start pack-refs by git's full path; a person may add -C or -c.
function isPackRefs(pid) {
  if (!/^\d+$/.test(pid ?? "")) return false;
  const ps = spawnSync("ps", ["-o", "args=", "-p", pid], { encoding: "utf8" });
  return ps.status === 0 && /^(?:\S*\/)?git(?: -[Cc] \S+)* pack-refs(?:\s|$)/.test(ps.stdout.trim());
}
function packedMain(cwd) {
  const file = join(resolve(cwd, git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")), "packed-refs");
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").split("\n").find(line => line.endsWith(" refs/heads/main"))?.split(" ")[0] ?? null;
}

// pre-push: a push to GitHub's main must keep everything already there.
function guardPush() {
  const cwd = process.cwd();
  for (const line of readFileSync(0, "utf8").trim().split("\n").filter(Boolean)) {
    const [localRef, localCommit, remoteRef, remoteCommit] = line.split(" ");
    if (remoteRef !== "refs/heads/main") continue;
    if (localRef === "(delete)" || ZERO.test(localCommit)) throw new GuardError("Do not delete GitHub's main.");
    if (ZERO.test(remoteCommit)) continue;
    if (!ok(cwd, "cat-file", "-e", `${remoteCommit}^{commit}`)) throw new GuardError("GitHub's main has commits this Mac has never seen. git fetch, bring origin/main into a task branch, merge it as usual, then push.");
    if (!isAncestor(cwd, remoteCommit, localCommit)) throw new GuardError(`This push would drop commits GitHub's main has (${remoteCommit.slice(0, 7)} is not in what you are pushing). Nothing was pushed.`);
  }
}

// ------------------------------------------------------------- the deploy
// Ships main exactly: from the shared folder, on main, clean, not mid-merge,
// and never behind the last deploy made here (refs/tryx/deployed), unless
// the owner asked for a rollback in this conversation: TRYX_ROLLBACK=1.
function deploy(command) {
  const cwd = process.cwd();
  const shared = sharedFolder(cwd);
  if (!command.length) throw new GuardError("Usage: main-guard.mjs deploy -- <command ...>");
  if (resolve(git(cwd, "rev-parse", "--show-toplevel")) !== resolve(git(shared, "rev-parse", "--show-toplevel"))) {
    throw new GuardError(`Deploy from the shared folder (${shared}), on main. A worktree's files are its branch, not main.`);
  }
  return withLock(shared, "a deploy", () => {
    const branch = git(shared, "branch", "--show-current");
    if (branch !== "main") throw new GuardError(`The shared folder is on ${branch || "no branch"}, not main. Nothing was deployed.`);
    const gitDir = git(shared, "rev-parse", "--path-format=absolute", "--git-dir");
    for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
      if (existsSync(join(gitDir, marker))) throw new GuardError(`The shared folder is in the middle of a ${marker.replace(/_HEAD|-.*/g, "").toLowerCase()}. Nothing was deployed.`);
    }
    const dirty = git(shared, "status", "--porcelain", "--untracked-files=normal");
    if (dirty) throw new GuardError(`The shared folder has changes that are not on main, and a deploy would ship them:\n${dirty.split("\n").slice(0, 10).join("\n")}\nNothing was deployed.`);
    const head = git(shared, "rev-parse", "HEAD");
    const last = revParseOrNull(shared, "refs/tryx/deployed");
    if (last && last !== head && !isAncestor(shared, last, head)) {
      if (process.env.TRYX_ROLLBACK !== "1") throw new GuardError(`The last deploy (${last.slice(0, 7)}) is not in main (${head.slice(0, 7)}): this deploy would take work off the live site.\nNothing was deployed. Only if the owner asked for a rollback: TRYX_ROLLBACK=1 npm run deploy`);
      console.log(`Rolling the live site back from ${last.slice(0, 7)} to ${head.slice(0, 7)}, as asked.`);
    }
    const run = spawnSync(command[0], command.slice(1), { cwd: shared, stdio: "inherit", env: { ...process.env, TRYX_DEPLOY_COMMIT: head.slice(0, 12) } });
    if (git(shared, "rev-parse", "HEAD") !== head) console.error("main moved during the deploy; that should not happen under the lock. Check what went live.");
    if (run.status !== 0) { process.exitCode = run.status ?? 1; return; }
    git(shared, "update-ref", "-m", "deployed", "refs/tryx/deployed", head);
    console.log(`\nDeployed main at ${head.slice(0, 7)}. Recorded as refs/tryx/deployed.`);
  });
}

export class GuardError extends Error {}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "dropped") {
      const branch = rest[0];
      if (!branch) throw new GuardError("Usage: main-guard.mjs dropped <branch>");
      const cwd = sharedFolder();
      if (!isAncestor(cwd, "main", branch)) throw new GuardError(`${branch} does not hold current main yet. Bring main in first (git merge main in its worktree), then check again.`);
      const lost = droppedByMerge(cwd, branch);
      const fork = forkPoint(cwd, branch);
      console.log(lost.size ? `Merging ${branch} would leave out lines main gained since it started:\n${describeDropped(cwd, lost, fork, "main")}` : `Merging ${branch} keeps everything main gained since it started.`);
    } else if (command === "deploy") deploy(rest[0] === "--" ? rest.slice(1) : rest);
    else if (command === "merge-message") guardMergeMessage(rest[0]);
    else if (command === "main-update") guardMainUpdate(rest[0], rest[1]);
    else if (command === "push") guardPush();
    else throw new GuardError("main-guard.mjs dropped <branch> | deploy -- <command> | merge-message <file> | main-update <phase> | push");
  } catch (error) {
    if (!(error instanceof GuardError)) throw error;
    console.error(`BLOCKED: ${error.message}`);
    process.exitCode = 1;
  }
}
