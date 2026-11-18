# PC DIY Market Monitor

A static page that shows DRAM, NAND and graphics card prices for a PC DIY
sales team. It is public: the repository and the page on GitHub Pages can be
read by anyone.

## How it works

- `site/` is the whole published page. `index.html` holds the words and
  structure, `app.js` the calculations and drawings, `runtime.js` the data
  loading, `app.css` the layout, and `look.css` every colour, typeface and
  corner. A new look is a change to `look.css`, not to `app.css`.
- `site/data/*.json` is what the page draws. `scripts/fetch.mjs` rewrites it
  from the source pages; `scripts/parse.mjs` holds the parsers.
- Price history has two layers. `spot_archive.json` and `gpu_archive.json`
  hold readings from Internet Archive copies of the spot board and the card
  tracker; `scripts/backfill.mjs` builds them by hand and they live on
  `main`. On every run the fetcher joins each archive with what earlier runs
  kept and with today's reading, into `spot_history.json` and
  `gpu_history.json`, which is what the page reads.
- `.github/workflows/refresh.yml` runs every hour, on every push to `main`
  and by hand. It runs the tests, restores the last data from the `data`
  branch, reads the source pages, saves the data back to `data`, and
  publishes `site/` to GitHub Pages. The `data` branch is written only by
  that workflow; never commit to it or merge it.
- The publish run writes the commit's short name over `__BUILD__` in
  `index.html` and into `build.json`. A page that finds the two differ loads
  the newest build, and every open page asks for the data again every five
  minutes. Keep `?v=__BUILD__` on every file `index.html` loads.
- `site/data/trendforce_outlook.json` is not fetched. It is edited by hand
  when TrendForce publishes a new forecast, from the release itself.
- Three files are kept on `main` and must never be taken from the `data`
  branch: `trendforce_outlook.json`, `spot_archive.json`, `gpu_archive.json`.
  The workflow's restore step excludes each by name, and a test checks it.

## Commands

- `npm test`: parsers against saved tables, data columns, and a check that
  nothing private is in the published files.
- `npm run fetch`: read the live pages into `site/data`.
- `npm run backfill`: rebuild the two archive files from the Internet
  Archive. `-- --parse` re-reads the saved copies without downloading. Copies
  are kept in `BACKFILL_CACHE` (default `.cache/backfill`, not in git).
- `npm run serve`: serve `site/` on `127.0.0.1:8931` (`HOST` and `PORT` from
  the environment).
- `npm run worktree -- new <who>/<task> | list | merge <branch> "<what>"`.

## Data is exact

- Every value is copied as the source prints it. Nothing is rounded,
  estimated, interpolated or filled from memory or another site.
- A parser that cannot find its table or read a cell throws. The fetcher then
  keeps the last good file and records the failure in `meta.json`; the page
  says which source was not read.
- Each series keeps one source. Card names and item names stay exactly as
  printed; a board item printed differently in an earlier year is joined to
  today's name through `BOARD_ALIASES`, and its row keeps the old spelling.
- A reading is dated by the date its own page prints, never by the day a
  copy was taken. A spot board table has its own "Last Update" line. The
  card tracker's tables have none, and its prices change only when the
  article does, so a reading takes the article's modified time.
- A reading read live replaces an archived one for the same day.
- When a source page changes shape, fix the parser and add the new table to
  `test/fixtures`, trimmed to its tables.

## This repository is public

- No keys, tokens or `.env` files. The fetcher needs none.
- No private addresses, machine names, personal email addresses or links to
  private documents. `npm test` checks for the known ones.
- Commits use the GitHub noreply address set in this repository's git config.

## Copy and layout

- No middle dot, em dash, exclamation mark or emoji in page copy.
- No thin line separators; space and fill separate.
- No chips, pills, arrows, gradients, glows, count-ups or moving text.
- The page is read by sales people in a hurry. Market health comes first: a
  verdict per market that says where the price stands against a year ago
  and which way it moved this month, and names the price it rests on. Then
  the key prices table: one row per price, the same period in the same
  column every time, a plain name before the exact item name.
- Periods are fixed: 1 week, 1 month, 3 months, 1 year, each against the
  reading nearest to that many days earlier. A cell with no reading near
  enough says so. No "since" a date that only reflects when collecting began.
- Every chart shares one period and one time axis, and its value axis starts
  at zero, so a short record looks short and a rise looks its real size.
- Colour means one thing: green is cheaper for builders, red is dearer. It
  always sits with a sign or a word. Charts and bars use one neutral ink.
- Every rule that judges a number (Falling, Rising, Steady, the levels in a
  verdict, which reading a period compares with, the card medians) is in
  `site/rules.js` and is tested. Do not judge a number anywhere else.
- Before rewording a string, ask whether it should exist at all.

## Parallel work

- One chat, one task, one branch, one worktree. Nobody edits or commits in
  this shared folder; it stays on `main` and clean.
- `npm run worktree -- new <who>/<task>` makes the worktree under
  `.claude/worktrees/`. `npm run worktree -- list` shows who is where.
- Commit on your branch before you finish.
- Merge one branch at a time with `npm run worktree -- merge`, and only when
  the owner says so in the current conversation. It runs the tests on the
  merged result.
- Only merged `main` is pushed, and only when the owner asks in the current
  conversation. A push to `main` publishes the page, so a push is a deploy.
- Never bypass a git hook with `--no-verify`.
