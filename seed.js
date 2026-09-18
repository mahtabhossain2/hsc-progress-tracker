/**
 * seed.js — imports the 391-day / 1117-task routine into Supabase,
 * using the full v2 schema (day_number, week_number, phase, subject,
 * task_type, progress_percent, order_index) when those columns exist.
 *
 * Usage:
 *   1. Run setup_v2.sql in the Supabase SQL editor first (recommended —
 *      this script still works without it, just with fewer columns).
 *   2. npm install @supabase/supabase-js
 *   3. node seed.js
 *
 * Safe to re-run: checks the current row count first and skips seeding
 * if the table already has rows (use --force to wipe & reseed).
 *
 * If the table already has data from the v1 delivery and you only need
 * to add the new columns to those existing rows, use backfill.js instead
 * — it does NOT touch completion progress. This script (seed.js) is for
 * an empty table only.
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dyxsjcwdvukdubjfraht.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_YytVTLnLPzQS51gAtB7PHQ_KBqocNtr";
const TABLE = "routine_tasks";
const BATCH_SIZE = 50;
const FORCE = process.argv.includes("--force");

const OPTIONAL_COLUMNS = ["order_index", "day_number", "week_number", "phase", "subject", "task_type", "progress_percent"];

function extractMissingColumn(message){
  if (!message) return null;
  const m = /column [`"']?([a-zA-Z_]+)[`"']?/i.exec(message);
  return m ? m[1] : null;
}

async function main(){
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const seedPath = path.join(__dirname, "seed_data_v2.json");
  const rows = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
  console.log(`Loaded ${rows.length} rows from seed_data_v2.json`);

  const { count, error: countErr } = await sb.from(TABLE).select("*", { count: "exact", head: true });
  if (countErr){
    console.error("Could not read table (check URL/key/RLS):", countErr.message);
    process.exit(1);
  }

  if (count > 0 && !FORCE){
    console.log(`Table already has ${count} rows. Nothing to do.`);
    console.log(`- To add new v2 columns to those existing rows without touching progress, run: node backfill.js`);
    console.log(`- To wipe and reseed from scratch (loses any progress you've made), run: node seed.js --force`);
    return;
  }

  if (count > 0 && FORCE){
    console.log(`--force passed: deleting existing ${count} rows first...`);
    const { error: delErr } = await sb.from(TABLE).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (delErr){
      console.error("Failed to clear table:", delErr.message);
      process.exit(1);
    }
  }

  let droppedColumns = new Set();
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE){
    const chunk = rows.slice(i, i + BATCH_SIZE).map(r => {
      const row = { title: r.title, section: r.section, description: r.description, completed: false };
      for (const col of OPTIONAL_COLUMNS){
        if (!droppedColumns.has(col)) row[col] = r[col];
      }
      return row;
    });

    let error;
    let attempts = 0;
    while (attempts < OPTIONAL_COLUMNS.length + 1){
      const result = await sb.from(TABLE).insert(chunk);
      error = result.error;
      if (!error) break;
      const badCol = extractMissingColumn(error.message);
      if (badCol && OPTIONAL_COLUMNS.includes(badCol) && !droppedColumns.has(badCol)){
        console.log(`Note: column '${badCol}' not found on table — continuing without it.`);
        droppedColumns.add(badCol);
        chunk.forEach(row => delete row[badCol]);
        attempts++;
        continue;
      }
      break;
    }

    if (error){
      console.error(`\nFailed at batch starting row ${i}:`, error.message);
      console.error(`${inserted} rows were inserted successfully before this error.`);
      process.exit(1);
    }

    inserted += chunk.length;
    process.stdout.write(`\rInserted ${inserted} / ${rows.length}`);
  }

  console.log(`\nDone. ${inserted} rows inserted into '${TABLE}'.`);
  if (droppedColumns.size > 0){
    console.log(`Columns skipped (not present on table): ${Array.from(droppedColumns).join(", ")}`);
    console.log("Run setup_v2.sql, then `node seed.js --force` if you want a full reseed with those columns populated.");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
