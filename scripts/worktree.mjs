// One chat, one task, one branch, one worktree (CLAUDE.md, Parallel work).
//   npm run worktree -- new claude/save-button     a branch off main in its own folder
//   npm run worktree -- list                       who is working where, and what is finished
//   npm run worktree -- merge claude/save-button "the Save button fix"
// The shared folder stays on main and clean, because other chats branch from
// whatever is checked out there.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const ok = (args, cwd) => spawnSync("git", args, { cwd, stdio: "ignore" }).status === 0;
const stop = message => { console.error(message); process.exit(1); };

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
  console.log(`${branch} is in ${dir}\nTests: npm test runs there as it is\nPreview: PORT=${port(dir)} npm run serve`);
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
  // One branch at a time: it already holds current main, the tests run on
  // the merged result, and main moves only if they pass.
  const what = rest.join(" ").trim();
  if (!branch || !what) stop('npm run worktree -- merge <branch> "<what it is, in a few words>"\nOnly after the owner has said to merge it in this conversation.');
  if (!ok(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], shared)) stop(`There is no branch ${branch}.`);
  if (trees[0].branch !== "main") stop(`The shared folder is on ${trees[0].branch || "no branch"}, not main. Nothing was merged.`);
  if (dirty(shared)) stop("The shared folder has uncommitted changes. Nothing was merged.");
  const tree = trees.find(tree => tree.branch === branch);
  if (tree && dirty(tree.path, "normal")) stop(`${tree.path} has uncommitted changes. Commit them first.`);
  if (!ahead(branch)) stop(`${branch} has nothing main lacks.`);
  if (!ok(["merge-base", "--is-ancestor", "main", branch], shared)) stop(`main has moved since ${branch} started. In ${tree?.path || "its worktree"}: git merge main, then npm test, then merge again.`);
  git(["merge", "--no-ff", "--no-commit", branch], shared);
  if (spawnSync("npm", ["test"], { cwd: shared, stdio: "inherit" }).status !== 0) {
    git(["merge", "--abort"], shared);
    stop("\nThe tests fail on the merged result. main is unchanged.");
  }
  const today = new Date().toLocaleDateString("en-CA");
  git(["commit", "-m", `Merge ${what} (owner approved ${today})`], shared);
  console.log(`\nmain has ${branch}. Not pushed, not deployed.${tree ? `\nFinished with it: git worktree remove ${place(tree.path)} && git branch -d ${branch}` : ""}`);
} else stop("npm run worktree -- new <who>/<task> | list | merge <branch> \"<what>\"");
