import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const vehicles = [
  { year: 2019, make: 'Toyota', model: 'Tacoma', submodel: 'TRD Off-Road', engine_liters: 3.5, engine_config: 'V6', body_style: 'Double Cab', drive_type: '4WD' },
  { year: 2019, make: 'Toyota', model: 'Tacoma', submodel: 'SR5', engine_liters: 3.5, engine_config: 'V6', body_style: 'Double Cab', drive_type: '4WD' },
  { year: 2019, make: 'Toyota', model: 'Tacoma', submodel: 'SR', engine_liters: 2.7, engine_config: 'L4', body_style: 'Access Cab', drive_type: '4WD' },
  { year: 2021, make: 'Ford', model: 'F-150', submodel: 'XLT', engine_liters: 5.0, engine_config: 'V8', body_style: 'SuperCrew', drive_type: '4WD' },
  { year: 2021, make: 'Ford', model: 'F-150', submodel: 'Lariat', engine_liters: 3.5, engine_config: 'V6', body_style: 'SuperCrew', drive_type: '4WD' },
  { year: 2020, make: 'Chevrolet', model: 'Silverado 1500', submodel: 'LT', engine_liters: 5.3, engine_config: 'V8', body_style: 'Crew Cab', drive_type: '4WD' },
  { year: 2018, make: 'Ford', model: 'Mustang', submodel: 'GT', engine_liters: 5.0, engine_config: 'V8', body_style: 'Coupe', drive_type: 'RWD' },
  { year: 2022, make: 'Jeep', model: 'Wrangler', submodel: 'Rubicon', engine_liters: 3.6, engine_config: 'V6', body_style: '4-Door', drive_type: '4WD' },
  { year: 2021, make: 'Ram', model: '1500', submodel: 'Big Horn', engine_liters: 5.7, engine_config: 'V8', body_style: 'Crew Cab', drive_type: '4WD' },
  { year: 2019, make: 'Toyota', model: 'Tacoma', submodel: 'TRD Pro', engine_liters: 3.5, engine_config: 'V6', body_style: 'Double Cab', drive_type: '4WD' },
];

const parts = [
  {
    sku: '19293',
    series: 'Street Series',
    part_type: 'cat-back',
    description: '2016-2023 Toyota Tacoma 3.5L Street Series Cat-Back. Dual muffler, passenger-side exit, 4in polished tips. Moderate exterior, mild interior sound.',
    price: 699.00,
    product_url: 'https://www.magnaflow.com/products/19293-magnaflow-2016-2023-toyota-tacoma-street-series-cat-back-performance-exhaust-system',
    sound_level: 'moderate',
    install_difficulty: 'bolt-on',
    emissions_standard: 'both',
    state_restrictions: null,
    is_lifted_compatible: true,
  },
  {
    sku: '19291',
    series: 'Street Series',
    part_type: 'cat-back',
    description: '2016-2023 Toyota Tacoma 3.5L Street Series Cat-Back. Single muffler, passenger-side exit. Slightly more aggressive note than 19293.',
    price: 649.00,
    product_url: 'https://www.magnaflow.com/products/19291-performance-exhaust-magnaflow-toyota-tacoma-street-series-cat-back-performance-exhaust-system',
    sound_level: 'moderate',
    install_difficulty: 'bolt-on',
    emissions_standard: 'both',
    state_restrictions: null,
    is_lifted_compatible: true,
  },
  {
    sku: '19583',
    series: 'Overland Series',
    part_type: 'cat-back',
    description: '2016-2023 Toyota Tacoma 3.5L Overland Series Cat-Back. High clearance design, ideal for lifted trucks. Off-road tuned.',
    price: 849.00,
    product_url: 'https://www.magnaflow.com/products/19583-magnaflow-2016-2023-toyota-tacoma-3-5l-overland-series-cat-back-performance-exhaust-system',
    sound_level: 'aggressive',
    install_difficulty: 'bolt-on',
    emissions_standard: 'both',
    state_restrictions: null,
    is_lifted_compatible: true,
  },
  {
    sku: '19835',
    series: 'SPEQ Series',
    part_type: 'cat-back',
    description: '2021-2026 Ford F-150 5.0L SPEQ Series Cat-Back. Single driver-side rear exit. Tuned for the Coyote V8.',
    price: 1200.00,
    product_url: 'https://www.magnaflow.com/products/19835-magnaflow-2021-2023-ford-f-150-2-7l-2021-2026-ford-f-150-5-0l-speq-series-cat-back-performance-exhaust-system-19835',
    sound_level: 'moderate',
    install_difficulty: 'bolt-on',
    emissions_standard: 'both',
    state_restrictions: null,
    is_lifted_compatible: true,
  },
];

// [vehicle_index, part_index, notes] — 0-based positions in arrays above
const fitmentMappings = [
  [0, 0, null],
  [0, 1, null],
  [0, 2, 'Best for lifted builds'],
  [1, 0, null],
  [1, 1, null],
  [9, 0, null],
  [9, 2, 'Recommended for TRD Pro clearance'],
  [3, 3, null],
];

const partAttributes = [
  { sku: '19293', attr_key: 'pipe_diameter', attr_val: '3in mandrel bent' },
  { sku: '19293', attr_key: 'tip_size', attr_val: '4in polished double-wall' },
  { sku: '19293', attr_key: 'exit_config', attr_val: 'single passenger-side rear' },
  { sku: '19293', attr_key: 'muffler_count', attr_val: '2' },
  { sku: '19583', attr_key: 'clearance', attr_val: 'high clearance off-road design' },
  { sku: '19583', attr_key: 'pipe_diameter', attr_val: '3in mandrel bent' },
  { sku: '19835', attr_key: 'pipe_diameter', attr_val: '3in' },
  { sku: '19835', attr_key: 'exit_config', attr_val: 'single driver-side rear' },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Seeding vehicles...');
    const vehicleIds = [];
    for (const v of vehicles) {
      const res = await client.query(
        `INSERT INTO vehicles (year, make, model, submodel, engine_liters, engine_config, body_style, drive_type, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual')
         ON CONFLICT DO NOTHING RETURNING id`,
        [v.year, v.make, v.model, v.submodel, v.engine_liters, v.engine_config, v.body_style, v.drive_type]
      );
      vehicleIds.push(res.rows[0]?.id);
    }

    console.log('Seeding parts...');
    const partIds = {};
    for (const p of parts) {
      const res = await client.query(
        `INSERT INTO parts (sku, series, part_type, description, price, product_url, sound_level, install_difficulty, emissions_standard, state_restrictions, is_lifted_compatible, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'manual')
         ON CONFLICT (sku) DO NOTHING RETURNING id`,
        [p.sku, p.series, p.part_type, p.description, p.price, p.product_url, p.sound_level, p.install_difficulty, p.emissions_standard, p.state_restrictions, p.is_lifted_compatible]
      );
      partIds[p.sku] = res.rows[0]?.id;
    }

    console.log('Seeding fitment...');
    for (const [vi, pi, notes] of fitmentMappings) {
      const vehicleId = vehicleIds[vi];
      const partId = partIds[parts[pi].sku];
      if (!vehicleId || !partId) continue;
      await client.query(
        `INSERT INTO fitment (vehicle_id, part_id, notes, source)
         VALUES ($1,$2,$3,'manual') ON CONFLICT DO NOTHING`,
        [vehicleId, partId, notes]
      );
    }

    console.log('Seeding part attributes...');
    for (const a of partAttributes) {
      const partId = partIds[a.sku];
      if (!partId) continue;
      await client.query(
        `INSERT INTO part_attributes (part_id, attr_key, attr_val) VALUES ($1,$2,$3)`,
        [partId, a.attr_key, a.attr_val]
      );
    }

    await client.query('COMMIT');
    console.log('Seed complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
