import pg from 'pg';
import dotenv from 'dotenv';
import { verifyVehicle } from './verify-fitment.js';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SAMPLE_SIZE = Number(process.env.SPOT_CHECK_SAMPLE_SIZE ?? 5);
const REQUEST_DELAY_MS = 2000;

// Intended to run as a standalone scheduled job (e.g. a Render Cron Job), fully decoupled
// from the chat web service — samples real customer recommendations from
// recommendation_log and checks them against the live MagnaFlow site out of band, so
// Playwright/Chromium never has to run inside the customer-facing request path.
async function main() {
  const { rows } = await pool.query(
    `SELECT * FROM recommendation_log WHERE checked_at IS NULL ORDER BY random() LIMIT $1`,
    [SAMPLE_SIZE]
  );

  if (rows.length === 0) {
    console.log('No unchecked recommendations to spot-check.');
    await pool.end();
    return;
  }

  for (const row of rows) {
    const label = `#${row.id} — ${row.year} ${row.make} ${row.model} ${row.submodel ?? ''} ${row.engine_liters ?? ''}L`;
    process.stdout.write(`Spot-checking ${label}... `);

    let result;
    try {
      result = await verifyVehicle({
        year: row.year,
        make: row.make,
        model: row.model,
        engineLiters: row.engine_liters,
        qualifiers: row.qualifiers ?? {},
        expectedSkus: row.skus,
      });
      console.log(result.match ? 'MATCH' : `MISMATCH — expected ${result.expected.join(',')}, found ${result.found.join(',')}`);
    } catch (err) {
      result = { match: false, error: err.message };
      console.log(`ERROR: ${err.message}`);
    }

    await pool.query(`UPDATE recommendation_log SET checked_at = NOW(), check_result = $2 WHERE id = $1`, [
      row.id,
      JSON.stringify(result),
    ]);

    if (result.match === false) {
      console.warn(`MISMATCH ALERT: recommendation ${label} did not match the live MagnaFlow site.`);
    }

    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  await pool.end();
}

main();
