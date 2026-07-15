import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// qualifiers: { [qualifierType]: qualifierValue } — customer-stated answers to fitment
// questions that go beyond year/make/model/engine (e.g. rear suspension type).
//
// Returns { matches, needsQualifier }. A fitment row with no linked qualifiers always
// matches once the vehicle fields match. A row gated on a qualifier only becomes a
// match once its qualifier is answered and matches; while unanswered, it's held back
// and surfaced in `needsQualifier` instead of being guessed at.
export async function lookupParts({ year, make, model, submodel, engineLiters, partType, lifted = false, qualifiers = {} }) {
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
      json_agg(DISTINCT jsonb_build_object('key', pa.attr_key, 'value', pa.attr_val))
        FILTER (WHERE pa.id IS NOT NULL) AS attributes,
      json_agg(DISTINCT jsonb_build_object('type', q.qualifier_type, 'value', q.qualifier_value, 'label', q.label))
        FILTER (WHERE q.id IS NOT NULL) AS required_qualifiers
    FROM vehicles v
    JOIN fitment f ON f.vehicle_id = v.id
    JOIN parts p ON p.id = f.part_id
    LEFT JOIN part_attributes pa ON pa.part_id = p.id
    LEFT JOIN fitment_qualifiers fq ON fq.fitment_id = f.id
    LEFT JOIN qualifiers q ON q.id = fq.qualifier_id
    WHERE ${conditions.join(' AND ')}
    GROUP BY f.id, p.id, f.notes
    ORDER BY p.price ASC
  `;

  const result = await pool.query(query, values);

  const matchesBySku = new Map();
  const pendingByType = new Map(); // qualifier_type -> Map(value -> label)

  for (const { required_qualifiers, ...part } of result.rows) {
    const required = required_qualifiers ?? [];
    const mismatched = required.some((rq) => rq.type in qualifiers && qualifiers[rq.type] !== rq.value);
    if (mismatched) continue; // this row doesn't apply to the customer's actual vehicle

    const unanswered = required.filter((rq) => !(rq.type in qualifiers));
    if (unanswered.length > 0) {
      for (const rq of unanswered) {
        if (!pendingByType.has(rq.type)) pendingByType.set(rq.type, new Map());
        pendingByType.get(rq.type).set(rq.value, rq.label);
      }
      continue; // don't surface as a confirmed match until the qualifier is answered
    }

    // The same part can legitimately match through more than one vehicle/fitment row
    // (e.g. the customer's answer was broad enough to span multiple trims) — never
    // show the same SKU to the customer twice.
    if (!matchesBySku.has(part.sku)) matchesBySku.set(part.sku, part);
  }

  const matches = [...matchesBySku.values()];

  const needsQualifier = [...pendingByType.entries()].map(([qualifierType, valueMap]) => ({
    qualifierType,
    options: [...valueMap.entries()].map(([value, label]) => ({ value, label })),
  }));

  return { matches, needsQualifier };
}

// Fire-and-forget log of a final recommendation, sampled later by qa/spot-check.js
// to verify against the live MagnaFlow site without touching the request path.
export async function logRecommendation({ year, make, model, submodel, engineLiters, qualifiers, skus }) {
  await pool.query(
    `INSERT INTO recommendation_log (year, make, model, submodel, engine_liters, qualifiers, skus)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [year ?? null, make ?? null, model ?? null, submodel ?? null, engineLiters ?? null, JSON.stringify(qualifiers ?? {}), skus]
  );
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
