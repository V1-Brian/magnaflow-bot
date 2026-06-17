import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function lookupParts({ year, make, model, submodel, engineLiters, partType, lifted = false }) {
  const conditions = ['1=1'];
  const values = [];
  let idx = 1;

  if (year)         { conditions.push(`v.year = $${idx++}`);               values.push(year); }
  if (make)         { conditions.push(`LOWER(v.make) = LOWER($${idx++})`);  values.push(make); }
  if (model)        { conditions.push(`LOWER(v.model) = LOWER($${idx++})`); values.push(model); }
  if (submodel)     { conditions.push(`LOWER(v.submodel) = LOWER($${idx++})`); values.push(submodel); }
  if (engineLiters) { conditions.push(`v.engine_liters = $${idx++}`);       values.push(engineLiters); }
  if (partType)     { conditions.push(`LOWER(p.part_type) = LOWER($${idx++})`); values.push(partType); }
  if (lifted)       { conditions.push(`p.is_lifted_compatible = true`); }

  const query = `
    SELECT
      p.sku,
      p.series,
      p.part_type,
      p.description,
      p.price,
      p.product_url,
      p.sound_level,
      p.install_difficulty,
      p.emissions_standard,
      p.state_restrictions,
      p.is_lifted_compatible,
      f.notes AS fitment_notes,
      json_agg(json_build_object('key', pa.attr_key, 'value', pa.attr_val))
        FILTER (WHERE pa.id IS NOT NULL) AS attributes
    FROM vehicles v
    JOIN fitment f ON f.vehicle_id = v.id
    JOIN parts p ON p.id = f.part_id
    LEFT JOIN part_attributes pa ON pa.part_id = p.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY p.id, f.notes
    ORDER BY p.price ASC
  `;

  const result = await pool.query(query, values);
  return result.rows;
}

export async function getPartBySku(sku) {
  const result = await pool.query(
    `SELECT p.*,
       json_agg(json_build_object('key', pa.attr_key, 'value', pa.attr_val))
         FILTER (WHERE pa.id IS NOT NULL) AS attributes
     FROM parts p
     LEFT JOIN part_attributes pa ON pa.part_id = p.id
     WHERE p.sku = $1
     GROUP BY p.id`,
    [sku]
  );
  return result.rows[0] ?? null;
}
