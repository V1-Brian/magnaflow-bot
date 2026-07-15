import fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

async function importPIES(filePath) {
  console.log('Importing PIES product data...');
  const xml = fs.readFileSync(filePath, 'utf-8');
  const data = parser.parse(xml);
  const items = data?.PIES?.Items?.Item ?? [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      const sku = item.PartNumber;
      const description = item.Descriptions?.Description?.[0]?.['#text'] ?? '';
      const price = parseFloat(item.Prices?.Price?.['#text'] ?? 0);
      await client.query(
        `INSERT INTO parts (sku, description, price, source)
         VALUES ($1,$2,$3,'pies')
         ON CONFLICT (sku) DO UPDATE SET description=$2, price=$3, source='pies'`,
        [sku, description, price]
      );
      const attrs = item.ExtendedInformation ?? {};
      for (const [key, val] of Object.entries(attrs)) {
        const partRes = await client.query('SELECT id FROM parts WHERE sku=$1', [sku]);
        if (!partRes.rows[0]) continue;
        await client.query(
          `INSERT INTO part_attributes (part_id, attr_key, attr_val)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [partRes.rows[0].id, key, String(val)]
        );
      }
    }
    await client.query('COMMIT');
    console.log(`PIES import complete: ${items.length} parts processed.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PIES import failed:', err);
  } finally {
    client.release();
  }
}

async function importACES(filePath) {
  console.log('Importing ACES fitment data...');
  const xml = fs.readFileSync(filePath, 'utf-8');
  const data = parser.parse(xml);
  const apps = data?.ACES?.App ?? [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const app of apps) {
      const sku = app.Part;
      const year = parseInt(app.Years?.['@_from'] ?? app.Year);
      const make = app.Make;
      const model = app.Model;
      const submodel = app.SubModel ?? null;
      const engineLiters = parseFloat(app.EngineBase?.Liter ?? 0) || null;
      const engineConfig = app.EngineBase?.Cylinders ?? null;
      const bodyStyle = app.BodyStyleConfig ?? null;
      const driveType = app.DriveType ?? null;

      const vRes = await client.query(
        `INSERT INTO vehicles (year, make, model, submodel, engine_liters, engine_config, body_style, drive_type, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'aces')
         ON CONFLICT DO NOTHING RETURNING id`,
        [year, make, model, submodel, engineLiters, engineConfig, bodyStyle, driveType]
      );
      let vehicleId = vRes.rows[0]?.id;
      if (!vehicleId) {
        const existing = await client.query(
          `SELECT id FROM vehicles WHERE year=$1 AND make=$2 AND model=$3
           AND COALESCE(submodel,'')=COALESCE($4,'')
           AND COALESCE(engine_liters,0)=COALESCE($5::numeric,0)`,
          [year, make, model, submodel, engineLiters]
        );
        vehicleId = existing.rows[0]?.id;
      }
      if (!vehicleId) continue;

      const pRes = await client.query('SELECT id FROM parts WHERE sku=$1', [sku]);
      const partId = pRes.rows[0]?.id;
      if (!partId) continue;

      await client.query(
        `INSERT INTO fitment (vehicle_id, part_id, source) VALUES ($1,$2,'aces') ON CONFLICT DO NOTHING`,
        [vehicleId, partId]
      );
    }
    await client.query('COMMIT');
    console.log(`ACES import complete: ${apps.length} applications processed.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ACES import failed:', err);
  } finally {
    client.release();
  }
}

(async () => {
  if (fs.existsSync('./data/pies.xml')) await importPIES('./data/pies.xml');
  if (fs.existsSync('./data/aces.xml')) await importACES('./data/aces.xml');
  await pool.end();
  console.log('Import complete. No schema changes required.');
})();
