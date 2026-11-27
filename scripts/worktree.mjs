// One chat, one task, one branch, one worktree (CLAUDE.md, Parallel work).
//   npm run worktree -- new claude/save-button     a branch off main in its own folder
//   npm run worktree -- list                       who is working where, and what is finished
//   npm run worktree -- check claude/save-button   what a merge would throw away of main's work
//   npm run worktree -- merge claude/save-button "the Save button fix"
// The shared folder stays on main and clean, because other chats branch from
// whatever is checked out there.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { GuardError, describeDropped, droppedByMerge, forkPoint, withLock } from "./main-guard.mjs";

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const ok = (args, cwd) => spawnSync("git", args, { cwd, stdio: "ignore" }).status === 0;
const stop = message => { console.error(message); process.exit(1); };
// Inside the lock a refusal throws, so the lock is let go on the way out.
const refuse = message => { throw new GuardError(message); };

// Git lists the shared folder first, then every linked worktree.
const trees = git(["worktree", "list", "--porcelain"]).split("\n\n").filter(Boolean).map(block => ({
  path: /^worktree (.*)$/m.exec(block)[1],
  branch: /^branch refs\/heads\/(.*)$/m.exec(block)?.[1] || "",
}));
const shared = trees[0].path;
const home = join(shared, ".claude", "worktrees");
// A preview port of its own, so two chats never look at each other's page.
const port = path => 8940 + [...path].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 100, 0);
const place = path => path.startsWith(shared + "/") ? relative(shared, path) : path;
// New files count as unsaved work in a task worktree; the shared folder is
// only asked about the files git tracks.
const dirty = (path, untracked = "no") => git(["status", "--porcelain", `--untracked-files=${untracked}`], path) !== "";
const ahead = branch => Number(git(["rev-list", "--count", `main..${branch}`], shared));

const [command, branch, ...rest] = process.argv.slice(2);

if (command === "new") {
  if (!/^[a-z0-9]+\/[a-z0-9][a-z0-9-]*$/.test(branch || "")) stop("Name it <who>/<task>, for example claude/save-button.");
  if (ok(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], shared)) stop(`${branch} already exists. npm run worktree -- list shows where it is.`);
  const dir = join(home, branch.split("/")[1]);
  if (existsSync(dir)) stop(`${dir} is already there.`);
  git(["config", "core.hooksPath", ".githooks"], shared);
  git(["worktree", "add", "-b", branch, dir, "main"], shared);
  // The tests need esbuild: the shared folder's node_modules is linked when
  // it has it, otherwise the worktree installs its own.
  let tests = "npm test runs there as it is";
  if (existsSync(join(shared, "node_modules", "esbuild"))) symlinkSync(join(shared, "node_modules"), join(dir, "node_modules"));
  else if (spawnSync("npm", ["ci", "--silent"], { cwd: dir, stdio: "inherit" }).status !== 0) tests = "run npm ci there before npm test";
  console.log(`${branch} is in ${dir}\nTests: ${tests}\nPreview: PORT=${port(dir)} npm run serve`);
} else if (command === "list") {
  const mainline = new Set(git(["rev-list", "--first-parent", "main"], shared).split("\n"));
  for (const [i, tree] of trees.entries()) {
    const notes = [];
    if (i === 0) notes.push(tree.branch === "main" ? "the shared folder, stays on main and clean" : `THE SHARED FOLDER IS OFF main: git switch main in ${shared}`);
    else if (!tree.branch) notes.push("DETACHED: its commits are on no branch");
    else {
      // A branch with nothing main lacks is either finished or not started.
      // Merges here are never fast-forwards, so a finished branch's tip is
      // off main's own line and a new branch's tip is on it.
      const own = ahead(tree.branch), unsaved = dirty(tree.path, "normal");
      if (own) notes.push(`${own} commit${own > 1 ? "s" : ""} not in main`);
      else if (mainline.has(git(["rev-parse", tree.branch], shared))) notes.push("no commits yet: new or in use, leave it");
      else notes.push(unsaved ? "merged" : `merged, safe to remove: git worktree remove ${place(tree.path)}`);
    }
    if (i && !tree.path.startsWith(home + "/")) notes.push(tree.path.startsWith("/private/tmp/") ? "IN A SCRATCHPAD, deleted with its session" : "outside .claude/worktrees");
    if (dirty(tree.path, i ? "normal" : "no")) notes.push("uncommitted changes");
    console.log(`${(tree.branch || "(no branch)").padEnd(28)} ${i ? ":" + port(tree.path) : ":8931"}  ${notes.join("; ")}\n${"".padEnd(28)} ${tree.path}`);
  }
  const loose = git(["branch", "--no-merged", "main", "--format=%(refname:short)"], shared).split("\n").filter(name => name && !trees.some(tree => tree.branch === name));
  if (loose.length) console.log(`\nNot in main and in no worktree: ${loose.join(", ")}`);
} else if (command === "merge") {
  // One branch at a time, under the lock deploys also take (main-guard.mjs).
  // The tests run in the branch's own worktree, whose files are exactly the
  // merged result since the branch already holds current main; main then
  // moves in one step. The shared folder is never left half-merged: in
  // Try KANALI on 2026-11-20 it was, for a whole test run, and two chats'
  // merges ran there at the same moment.
  const drops = rest.indexOf("--drops");
  const why = drops >= 0 ? rest.splice(drops, 2)[1]?.trim() : "";
  const what = rest.join(" ").trim();
  if (!branch || !what || (drops >= 0 && !why)) stop('npm run worktree -- merge <branch> "<what it is, in a few words>" [--drops "<what it removes on purpose, and why>"]\nOnly after the owner has said to merge it in this conversation.');
  if (!ok(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], shared)) stop(`There is no branch ${branch}.`);
  const tree = trees.find(tree => tree.branch === branch);
  if (!tree) stop(`${branch} is in no worktree. The tests run in its worktree: git worktree add .claude/worktrees/${branch.split("/")[1]} ${branch}`);
  // The hooks enforce the rest; a repository cloned fresh has them off.
  git(["config", "core.hooksPath", ".githooks"], shared);
  try {
    withLock(shared, `merging ${branch}`, token => {
      const current = git(["branch", "--show-current"], shared);
      if (current !== "main") refuse(`The shared folder is on ${current || "no branch"}, not main. Nothing was merged.`);
      if (dirty(shared)) refuse("The shared folder has uncommitted changes. Nothing was merged.");
      if (dirty(tree.path, "normal")) refuse(`${tree.path} has uncommitted changes. Commit them first.`);
      if (!ahead(branch)) refuse(`${branch} has nothing main lacks.`);
      if (!ok(["merge-base", "--is-ancestor", "main", branch], shared)) refuse(`main has moved since ${branch} started. In ${tree.path}: git merge main, then npm test, then merge again.`);
      const lost = droppedByMerge(shared, branch);
      if (lost.size && !why) refuse(`${branch} leaves out lines main gained while it was being worked on:\n${describeDropped(shared, lost, forkPoint(shared, branch), "main")}\n\nThat is how a merge rolls back another chat's work. Put them back in ${tree.path} and commit,\nor, only if removing them is the point of this branch, merge again with --drops "<what and why>". Nothing was merged.`);
      const base = git(["rev-parse", "main"], shared), tip = git(["rev-parse", branch], shared);
      if (spawnSync("npm", ["test"], { cwd: tree.path, stdio: "inherit" }).status !== 0) refuse(`\nThe tests fail in ${tree.path}. main is unchanged.`);
      if (git(["rev-parse", branch], shared) !== tip || dirty(tree.path, "normal")) refuse(`${branch} changed while its tests ran. main is unchanged; merge again.`);
      const today = new Date().toLocaleDateString("en-CA");
      const message = `Merge ${what} (owner approved ${today})${why ? `\n\nDrops: ${why}` : ""}`;
      const commit = execFileSync("git", ["commit-tree", `${tip}^{tree}`, "-p", base, "-p", tip, "-m", message], { cwd: shared, encoding: "utf8" }).trim();
      execFileSync("git", ["merge", "--ff-only", "--quiet", commit], { cwd: shared, stdio: "inherit", env: { ...process.env, TRYX_MAIN_TOKEN: token } });
    });
  } catch (error) {
    if (!(error instanceof GuardError)) throw error;
    stop(error.message.startsWith("BLOCKED") ? error.message : `BLOCKED: ${error.message}`);
  }
  console.log(`\nmain has ${branch}. Not pushed, not deployed.\nFinished with it: git worktree remove ${place(tree.path)} && git branch -d ${branch}`);
} else if (command === "check") {
  // What a merge would throw away, before asking the owner to merge.
  if (!branch) stop("npm run worktree -- check <branch>");
  execFileSync(process.execPath, [join(import.meta.dirname, "main-guard.mjs"), "dropped", branch], { cwd: shared, stdio: "inherit" });
} else stop("npm run worktree -- new <who>/<task> | list | check <branch> | merge <branch> \"<what>\" [--drops \"<why>\"]");
