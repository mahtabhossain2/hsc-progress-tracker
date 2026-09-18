/**
 * backfill.js — populates day_number / week_number / phase / subject /
 * task_type / order_index on ROWS THAT ALREADY EXIST in routine_tasks.
 *
 * This does NOT insert, delete, or touch `completed` / `progress_percent`
 * on any row. It matches each existing row by its (unique) `title` against
 * seed_data_v2.json and fills in only the new metadata columns.
 *
 * Safe to re-run any number of times.
 *
 * Usage:
 *   1. Run setup_v2.sql in Supabase first (adds the columns).
 *   2. npm install @supabase/supabase-js
 *   3. node backfill.js
 *
 * If your routine_tasks table is still empty (fresh project, never
 * seeded), run seed.js instead — it inserts everything in one go,
 * new columns included, and this script has nothing to do.
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dyxsjcwdvukdubjfraht.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_YytVTLnLPzQS51gAtB7PHQ_KBqocNtr";
const TABLE = "routine_tasks";

async function main(){
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const seedPath = path.join(__dirname, "seed_data_v2.json");
  const reference = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
  const byTitle = new Map(reference.map(r => [r.title, r]));

  console.log(`Loaded ${reference.length} reference rows.`);

  // Pull existing rows (paginated — default PostgREST cap is 1000/request)
  let existing = [];
  let from = 0;
  const PAGE = 1000;
  while (true){
    const { data, error } = await sb.from(TABLE).select("id,title,day_number").range(from, from + PAGE - 1);
    if (error){ console.error("Failed to read table:", error.message); process.exit(1); }
    existing = existing.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Found ${existing.length} existing rows in ${TABLE}.`);

  let updated = 0, skippedAlready = 0, unmatched = 0;

  for (const row of existing){
    if (row.day_number !== null && row.day_number !== undefined){
      skippedAlready++;
      continue; // already backfilled
    }
    const ref = byTitle.get(row.title);
    if (!ref){
      unmatched++;
      console.warn(`No reference match for existing row: "${row.title}" — leaving it untouched.`);
      continue;
    }
    const { error } = await sb.from(TABLE).update({
      day_number: ref.day_number,
      week_number: ref.week_number,
      phase: ref.phase,
      subject: ref.subject,
      task_type: ref.task_type,
      order_index: ref.order_index,
    }).eq("id", row.id);

    if (error){
      console.error(`Failed to update row ${row.id} ("${row.title}"):`, error.message);
      continue;
    }
    updated++;
    if (updated % 50 === 0) process.stdout.write(`\rBackfilled ${updated}...`);
  }

  console.log(`\nDone. Backfilled: ${updated}. Already had data: ${skippedAlready}. Unmatched (left untouched): ${unmatched}.`);
  if (unmatched > 0){
    console.log("Unmatched rows are usually custom tasks you added yourself through the Editor — that's expected, not an error.");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
