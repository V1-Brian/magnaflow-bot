import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { verifyVehicle } from './verify-fitment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'backend', 'src', 'db', 'data', 'catalog.json'), 'utf-8')
);

const partTypeBySku = new Map(catalog.parts.map((p) => [p.sku, p.part_type]));

// MagnaFlow's own site models our one qualifier case (Ram 1500 Classic vs. redesigned)
// as two separate `model` values ("1500 Classic" vs "1500"), not a sub-field within "1500"
// the way our schema does — confirmed by inspecting the live site's vehicle picker. This
// maps our qualifier answer to the site's actual model name for that one case.
function siteModelFor(vehicle, qualifiers) {
  if (vehicle.make === 'Ram' && vehicle.model === '1500') {
    // Some vehicle rows carry "Classic" in the submodel itself (e.g. "Classic Warlock",
    // "Classic Tradesman") with no qualifier row at all — those need "1500 Classic" too,
    // not just rows explicitly gated on the rear_suspension qualifier.
    if (qualifiers.rear_suspension === 'leaf_spring') return '1500 Classic';
    if (qualifiers.rear_suspension === 'coil_spring') return '1500';
    if (/classic/i.test(vehicle.submodel ?? '')) return '1500 Classic';
  }
  return vehicle.model;
}

// Confirmed empirically: a 2s delay across ~15 rapid checks triggers something on
// MagnaFlow's side (rate limiting or bot detection) that silently returns empty results
// for the rest of the run — cases that pass fine in isolation showed nothing during a full
// batch run. Raised to 8s; if long batches still go empty partway through, raise further.
const REQUEST_DELAY_MS = 8000;

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
        model: siteModelFor(testCase.vehicle, testCase.qualifiers),
        submodel: testCase.vehicle.submodel,
        bodyStyle: testCase.vehicle.body_style,
        engineLiters: testCase.vehicle.engine_liters,
        partType: partTypeBySku.get(testCase.expectedSkus[0]),
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
