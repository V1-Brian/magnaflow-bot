import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'catalog.json'), 'utf-8'));

function vehicleKey(v) {
  return [v.year, v.make, v.model, v.submodel ?? '', v.engine_liters ?? ''].join('|');
}

async function upsertVehicle(client, v) {
  const existing = await client.query(
    `SELECT id FROM vehicles WHERE year=$1 AND make=$2 AND model=$3
     AND COALESCE(submodel,'')=COALESCE($4,'') AND COALESCE(engine_liters,0)=COALESCE($5::numeric,0)`,
    [v.year, v.make, v.model, v.submodel, v.engine_liters]
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const res = await client.query(
    `INSERT INTO vehicles (year, make, model, submodel, engine_liters, engine_config, body_style, drive_type, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual') RETURNING id`,
    [v.year, v.make, v.model, v.submodel, v.engine_liters, v.engine_config, v.body_style, v.drive_type]
  );
  return res.rows[0].id;
}

async function upsertPart(client, p) {
  const res = await client.query(
    `INSERT INTO parts (sku, series, part_type, description, price, product_url, sound_level, install_difficulty, emissions_standard, state_restrictions, is_lifted_compatible, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'manual')
     ON CONFLICT (sku) DO UPDATE SET
       series=$2, part_type=$3, description=$4, price=$5, product_url=$6,
       sound_level=$7, install_difficulty=$8, emissions_standard=$9,
       state_restrictions=$10, is_lifted_compatible=$11
     RETURNING id`,
    [p.sku, p.series, p.part_type, p.description, p.price, p.product_url, p.sound_level, p.install_difficulty, p.emissions_standard, p.state_restrictions, p.is_lifted_compatible]
  );
  return res.rows[0].id;
}

async function upsertQualifier(client, q) {
  const res = await client.query(
    `INSERT INTO qualifiers (qualifier_type, qualifier_value, label) VALUES ($1,$2,$3)
     ON CONFLICT (qualifier_type, qualifier_value) DO UPDATE SET label=$3
     RETURNING id`,
    [q.type, q.value, q.label]
  );
  return res.rows[0].id;
}

async function upsertFitment(client, vehicleId, partId, notes) {
  const res = await client.query(
    `INSERT INTO fitment (vehicle_id, part_id, notes, source) VALUES ($1,$2,$3,'manual')
     ON CONFLICT (vehicle_id, part_id) DO UPDATE SET notes=$3
     RETURNING id`,
    [vehicleId, partId, notes]
  );
  return res.rows[0].id;
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Seeding vehicles...');
    const vehicleIds = {};
    for (const v of catalog.vehicles) {
      vehicleIds[vehicleKey(v)] = await upsertVehicle(client, v);
    }

    console.log('Seeding parts...');
    const partIds = {};
    for (const p of catalog.parts) {
      partIds[p.sku] = await upsertPart(client, p);
    }

    console.log('Seeding qualifiers...');
    const qualifierIds = {};
    for (const q of catalog.qualifiers ?? []) {
      qualifierIds[`${q.type}|${q.value}`] = await upsertQualifier(client, q);
    }

    console.log('Seeding fitment...');
    for (const f of catalog.fitment) {
      const vehicleId = vehicleIds[vehicleKey(f.vehicle)];
      const partId = partIds[f.sku];
      if (!vehicleId || !partId) {
        console.warn(`Skipping fitment row — unresolved vehicle or SKU: ${JSON.stringify(f)}`);
        continue;
      }
      const fitmentId = await upsertFitment(client, vehicleId, partId, f.notes ?? null);

      for (const fq of f.qualifiers ?? []) {
        const qualifierId = qualifierIds[`${fq.type}|${fq.value}`];
        if (!qualifierId) {
          console.warn(`Skipping unresolved qualifier ${fq.type}=${fq.value} on fitment ${fitmentId}`);
          continue;
        }
        await client.query(
          `INSERT INTO fitment_qualifiers (fitment_id, qualifier_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [fitmentId, qualifierId]
        );
      }
    }

    console.log('Seeding part attributes...');
    for (const a of catalog.part_attributes) {
      const partId = partIds[a.sku];
      if (!partId) continue;
      await client.query(
        `INSERT INTO part_attributes (part_id, attr_key, attr_val) VALUES ($1,$2,$3)
         ON CONFLICT (part_id, attr_key) DO UPDATE SET attr_val=$3`,
        [partId, a.attr_key, a.attr_val]
      );
    }

    await client.query('COMMIT');
    console.log(`Seed complete: ${catalog.vehicles.length} vehicles, ${catalog.parts.length} parts, ${catalog.fitment.length} fitment rows, ${catalog.qualifiers?.length ?? 0} qualifiers.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
