import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { verifyVehicle } from './verify-fitment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'backend', 'src', 'db', 'data', 'catalog.json'), 'utf-8')
);

const REQUEST_DELAY_MS = 2000; // politeness delay between live-site checks

function vehicleKey(v) {
  return [v.year, v.make, v.model, v.submodel ?? '', v.engine_liters ?? ''].join('|');
}

function qualifierSignature(quals) {
  return Object.entries(quals)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

// One vehicle can have some fitment rows that apply unconditionally and some gated on a
// qualifier (e.g. Ram 1500 vs Ram 1500 Classic). Build one test case per distinct
// qualifier answer, always including the unconditional rows.
function buildTestCases() {
  const byVehicle = new Map();
  for (const f of catalog.fitment) {
    const key = vehicleKey(f.vehicle);
    if (!byVehicle.has(key)) {
      byVehicle.set(key, { vehicle: f.vehicle, unconditional: [], byQualifier: new Map() });
    }
    const bucket = byVehicle.get(key);
    if (f.qualifiers?.length) {
      const quals = Object.fromEntries(f.qualifiers.map((q) => [q.type, q.value]));
      const sig = qualifierSignature(quals);
      if (!bucket.byQualifier.has(sig)) bucket.byQualifier.set(sig, { quals, skus: [] });
      bucket.byQualifier.get(sig).skus.push(f.sku);
    } else {
      bucket.unconditional.push(f.sku);
    }
  }

  const cases = [];
  for (const { vehicle, unconditional, byQualifier } of byVehicle.values()) {
    if (byQualifier.size === 0) {
      cases.push({ vehicle, qualifiers: {}, expectedSkus: unconditional });
    } else {
      for (const { quals, skus } of byQualifier.values()) {
        cases.push({ vehicle, qualifiers: quals, expectedSkus: [...unconditional, ...skus] });
      }
    }
  }
  return cases;
}

function labelFor(vehicle) {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.submodel ?? ''} ${vehicle.engine_liters ?? ''}L`.replace(/\s+/g, ' ');
}

async function main() {
  const cases = buildTestCases();
  const limitFlagIdx = process.argv.indexOf('--limit');
  const limit = limitFlagIdx >= 0 ? Number(process.argv[limitFlagIdx + 1]) : cases.length;

  console.log(`Checking ${Math.min(limit, cases.length)} of ${cases.length} vehicle/qualifier combinations against the live MagnaFlow site...`);
  if (limit < cases.length) console.log(`(limited via --limit ${limit} — remaining ${cases.length - limit} not checked this run)`);

  const results = [];
  for (const testCase of cases.slice(0, limit)) {
    const label = labelFor(testCase.vehicle);
    process.stdout.write(`Checking ${label} ${JSON.stringify(testCase.qualifiers)}... `);
    try {
      const result = await verifyVehicle({
        year: testCase.vehicle.year,
        make: testCase.vehicle.make,
        model: testCase.vehicle.model,
        engineLiters: testCase.vehicle.engine_liters,
        qualifiers: testCase.qualifiers,
        expectedSkus: testCase.expectedSkus,
      });
      results.push({ label, qualifiers: testCase.qualifiers, ...result });
      console.log(result.match ? 'MATCH' : `MISMATCH (expected ${result.expected.join(',')}, found ${result.found.join(',')})`);
    } catch (err) {
      results.push({ label, qualifiers: testCase.qualifiers, match: false, error: err.message });
      console.log(`ERROR: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  const mismatches = results.filter((r) => !r.match);
  const reportPath = path.join(__dirname, `catalog-check-report-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

  console.log(`\n${results.length - mismatches.length}/${results.length} matched.`);
  if (mismatches.length > 0) {
    console.log(`${mismatches.length} mismatch(es) — full report at ${reportPath}`);
    process.exitCode = 1;
  }
}

main();
