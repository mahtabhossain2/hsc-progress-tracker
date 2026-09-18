# Study Planner — HSC 28 Academic to Admission (v2)

A premium, light, minimal student study-management dashboard for the 391-day
HSC-to-admission routine (from `Master_Plan_Routine.pdf`), backed by
Supabase. This is the redesigned v2 of the original single-page tracker:
same underlying data (391 days, 1117 tasks, 3 phases, 58 weeks), full
navigation, day-by-day workflow, subject/phase breakdowns, notes/reports,
and a proper editor.

## What's in this folder

| File | Purpose |
|---|---|
| `index.html` | The complete app — one self-contained HTML file (multi-view dashboard, Supabase client, embedded 1117-task v2 dataset). Open directly in a browser or deploy anywhere static files are served. |
| `seed_data_v2.json` | The full 391-day / 1117-task dataset, v2 schema (includes `day_number`, `week_number`, `phase`, `subject`, `task_type`, `progress_percent`). |
| `seed.js` | Seeds an **empty** `routine_tasks` table from scratch. Safe to re-run — does nothing if the table already has rows. |
| `backfill.js` | For a table that **already has your v1 data**: adds the new v2 columns to those existing rows by matching on `title`, without touching `completed` or anything else you've already done. Run this instead of `seed.js` if you're upgrading from the original delivery. |
| `setup_v2.sql` | Run once in the Supabase SQL editor: adds the new columns (`progress_percent`, `day_number`, `week_number`, `phase`, `subject`, `task_type`, `order_index`) and creates `daily_reports`, `weekly_reports`, `user_settings`, plus RLS policies for all four tables. |
| `package.json` | Dependency for the two Node scripts (`@supabase/supabase-js`). |

## Is my existing data safe?

**Yes.** Nothing in this upgrade deletes or overwrites your `routine_tasks`
rows or their `completed` status:

- The app **detects your existing data** on load. If your table already has
  1117 rows from the v1 delivery, it does not reseed — it only backfills the
  *new* columns (`day_number`, `week_number`, `phase`, `subject`,
  `task_type`) onto those existing rows, matched by each row's unique
  `title`. Your `completed` values are left exactly as they were.
- `progress_percent` is initialized to `100` for rows already marked
  `completed = true`, and `0` otherwise — it is never used to *lower* or
  override a completion you already recorded.
- `seed.js` (the insert-everything script) refuses to run if the table
  already has rows, unless you explicitly pass `--force` (which wipes and
  reseeds — only use this on a table you're fine losing progress on).
- The app itself does this backfill automatically the first time you load
  `index.html` after running `setup_v2.sql` — you don't have to run
  `backfill.js` by hand, though it's there if you'd rather do it from the
  command line or the auto-backfill hits an error partway through.

## Required SQL migration

Run **`setup_v2.sql`** once in Supabase → SQL Editor. It is additive and
idempotent (every statement uses `IF NOT EXISTS` / safe upserts), so it's
safe to run even if some of it was already applied. It:

1. Adds `progress_percent`, `day_number`, `week_number`, `phase`, `subject`,
   `task_type`, `order_index` to `routine_tasks` (all nullable/defaulted —
   existing rows are untouched by the `ALTER TABLE` itself).
2. Creates `daily_reports`, `weekly_reports`, `user_settings` if they don't
   exist yet.
3. Enables RLS and adds anon-key policies on all four tables (see "Security
   note" below).

After running it, just open `index.html` — the app will backfill the new
columns onto your existing 1117 rows automatically (with a visible progress
banner), then load normally.

## What's new in this version

- **Real navigation** — sidebar on desktop, bottom nav on mobile, six
  sections: Dashboard, My Routine, Phases, Subjects, Reports, Editor.
- **Dashboard** shows overall stats (progress %, tasks/days
  completed/remaining, current day, current phase) and a prominent
  "Today's Study" card for whatever day you're currently on, with a
  **Continue Day N** button. Current day is persisted in Supabase
  (`user_settings`), not the browser.
- **Day view** (`#/day/N`) — the day's tasks grouped by subject, a progress
  bar, and Previous/Next/jump-to-day navigation across all 391 days. Moving
  to the next day never blocks you — if the current day isn't 100% done you
  just get a small notice; unfinished tasks stay right where they are.
  Revision days (every 7th day) get a distinct "REVISION DAY" tag and a
  weekly report summary (days' progress, completed/unfinished topics).
- **Automatic day advance** — when *the current day specifically* reaches
  100%, the app moves `current_day` forward by one. Completing a future or
  past day out of order doesn't jump you around.
- **Per-task progress** — every task supports both a one-click "Done" toggle
  and a 0–100% (steps of 10) dropdown. Setting 100% marks it completed;
  anything below un-marks it. Both write straight to Supabase.
- **Phases page** — 3 phase cards (Academic / Pre Admission / Full
  Admission) with day/task completion stats; opening one lets you jump to
  any of its days.
- **Subjects page** — every subject that actually appears in the routine
  (derived from the real data, not assumed), each with its own progress and
  a full serial list of that subject's tasks across all 391 days.
- **Reports** — a daily note editor per day (free-text: what you studied,
  completed, couldn't finish, learned, problems, tomorrow's plan — or
  whatever format you prefer, it's a plain textarea) saved to
  `daily_reports`, plus weekly revision-day summaries with auto-computed
  stats saved to `weekly_reports`. Both persist across refreshes/devices and
  are only overwritten when you explicitly click Save.
- **Editor** — search/filter by day, phase, or title; add/edit/delete any
  task, with a confirmation prompt before delete ("This will permanently
  remove this task from your routine. Continue?"). Editing lets you change
  title, description, day/week/phase/subject/type, and progress.
- **Design** — white background, light-gray surfaces, charcoal text, blue
  for navigation/primary actions, green for completed, orange/red reserved
  for warnings — no dark mode, no gradients, no heavy shadows.
- **Mobile-first** — bottom nav, stacked cards (no data tables), large tap
  targets, no horizontal scrolling.

## Security note (same as before, now covering 4 tables)

This app talks to Supabase with your **publishable/anon key**, directly
from the browser — appropriate here since it's a personal, single-user tool
with no login screen. `user_settings` (the "current day" pointer) is a
single shared row, not per-user data — there's no auth system, so this
correctly reflects that it isn't user-isolated. Treat the anon key as
"anyone who has this HTML file can read/write these 4 tables," because
that's literally what the RLS policies in `setup_v2.sql` grant. If you ever
add real login, revisit these policies.

## Running it

Open `index.html` in a browser — the Supabase URL and publishable key are
already embedded. First load after `setup_v2.sql` will show a short
"upgrading existing data" progress banner (backfill), then the dashboard.

**Command-line alternative to the in-app backfill:**
```bash
npm install
node backfill.js          # for a table that already has your v1 data
node seed.js               # for a brand-new, empty table
node seed.js --force       # wipes and reseeds (loses progress — use with care)
```

## Deploying

`index.html` is fully self-contained — no build step, no bundler:
- **GitHub Pages:** push this folder, enable Pages, done.
- **Netlify / Vercel / Cloudflare Pages:** drag-and-drop the folder or point
  a static deploy at it.
- Anywhere else that serves static files works the same way.

## Data provenance

The routine content (391 days, 3 phases, 58 weeks, subjects, and topics) was
extracted from `Master_Plan_Routine.pdf` via OCR (the PDF's embedded fonts
don't map to Unicode correctly for direct text extraction, so pages were
rasterized and read with Tesseract Bengali+English OCR), then structured
and validated day-by-day against the source, including a handful of
individual topics corrected by direct visual inspection where OCR
confidence was low. `day_number` / `week_number` / `phase` / `subject` /
`task_type` in the v2 schema are all derived from that same validated
extraction — nothing new was invented for this redesign.
