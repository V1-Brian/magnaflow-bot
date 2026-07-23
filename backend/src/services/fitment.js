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
//
// Separately: submodel/bodyStyle/driveType/engineConfig are vehicle-identifying fields
// the customer may not have stated. If, once qualifiers are resolved, some candidate
// part only applies to a subset of the distinct values seen for one of those fields
// (not every one), that field genuinely determines fitment — everything is held back
// and that field is surfaced the same way an unanswered qualifier is, rather than
// guessing which trim/body/drivetrain the customer actually has.
export async function lookupParts({ year, make, model, submodel, engineLiters, bodyStyle, driveType, engineConfig, partType, lifted = false, qualifiers = {} }) {
  const conditions = ['1=1'];
  const values = [];
  let idx = 1;

  if (year)         { conditions.push(`v.year = $${idx++}`);               values.push(year); }
  if (make)         { conditions.push(`LOWER(v.make) = LOWER($${idx++})`);  values.push(make); }
  // Prefix match, not exact — some models are stored under a fuller official name than
  // customers naturally say (e.g. catalog "F-250 Super Duty" vs. a customer's plain "F-250").
  // Verified safe against the seeded catalog: no two distinct model values share a prefix
  // relationship (unlike submodel, which does — e.g. "Rubicon" vs "Rubicon 392" — so this
  // same trick is NOT applied to submodel matching).
  if (model)        { conditions.push(`LOWER(v.model) LIKE LOWER($${idx++}) || '%'`); values.push(model); }
  if (submodel)     { conditions.push(`LOWER(v.submodel) = LOWER($${idx++})`); values.push(submodel); }
  if (engineLiters) { conditions.push(`v.engine_liters = $${idx++}`);       values.push(engineLiters); }
  if (bodyStyle)    { conditions.push(`LOWER(v.body_style) = LOWER($${idx++})`); values.push(bodyStyle); }
  if (driveType)    { conditions.push(`LOWER(v.drive_type) = LOWER($${idx++})`); values.push(driveType); }
  if (engineConfig) { conditions.push(`LOWER(v.engine_config) = LOWER($${idx++})`); values.push(engineConfig); }
  if (partType)     { conditions.push(`LOWER(p.part_type) = LOWER($${idx++})`); values.push(partType); }
  if (lifted)       { conditions.push(`p.is_lifted_compatible = true`); }

  const query = `
    SELECT
      v.submodel AS vehicle_submodel,
      v.body_style AS vehicle_body_style,
      v.drive_type AS vehicle_drive_type,
      v.engine_config AS vehicle_engine_config,
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
    GROUP BY f.id, p.id, f.notes, v.submodel, v.body_style, v.drive_type, v.engine_config
    ORDER BY p.price ASC
  `;

  const result = await pool.query(query, values);

  const AMBIGUITY_DIMENSIONS = [
    { given: submodel, column: 'vehicle_submodel', qualifierType: 'trim' },
    { given: bodyStyle, column: 'vehicle_body_style', qualifierType: 'body_style' },
    { given: driveType, column: 'vehicle_drive_type', qualifierType: 'drive_type' },
    { given: engineConfig, column: 'vehicle_engine_config', qualifierType: 'engine_config' },
  ].filter((d) => !d.given);

  const matchesBySku = new Map();
  const pendingByType = new Map(); // qualifier_type -> { kind: 'qualifier' | 'vehicle_field', values: Map(value -> label) }
  const dimValuesSeen = new Map(AMBIGUITY_DIMENSIONS.map((d) => [d.qualifierType, new Set()]));
  const dimValuesBySku = new Map(AMBIGUITY_DIMENSIONS.map((d) => [d.qualifierType, new Map()]));

  for (const row of result.rows) {
    const { required_qualifiers, vehicle_submodel, vehicle_body_style, vehicle_drive_type, vehicle_engine_config, ...part } = row;
    const rowDimValues = {
      trim: vehicle_submodel,
      body_style: vehicle_body_style,
      drive_type: vehicle_drive_type,
      engine_config: vehicle_engine_config,
    };

    for (const dim of AMBIGUITY_DIMENSIONS) {
      const val = rowDimValues[dim.qualifierType];
      if (val) dimValuesSeen.get(dim.qualifierType).add(val);
    }

    const required = required_qualifiers ?? [];
    const mismatched = required.some((rq) => rq.type in qualifiers && qualifiers[rq.type] !== rq.value);
    if (mismatched) continue; // this row doesn't apply to the customer's actual vehicle

    const unanswered = required.filter((rq) => !(rq.type in qualifiers));
    if (unanswered.length > 0) {
      for (const rq of unanswered) {
        if (!pendingByType.has(rq.type)) pendingByType.set(rq.type, { kind: 'qualifier', values: new Map() });
        pendingByType.get(rq.type).values.set(rq.value, rq.label);
      }
      continue; // don't surface as a confirmed match until the qualifier is answered
    }

    // The same part can legitimately match through more than one vehicle/fitment row
    // (e.g. the customer's answer was broad enough to span multiple trims) — never
    // show the same SKU to the customer twice.
    if (!matchesBySku.has(part.sku)) matchesBySku.set(part.sku, part);

    for (const dim of AMBIGUITY_DIMENSIONS) {
      const val = rowDimValues[dim.qualifierType];
      if (!val) continue;
      const bySku = dimValuesBySku.get(dim.qualifierType);
      if (!bySku.has(part.sku)) bySku.set(part.sku, new Set());
      bySku.get(part.sku).add(val);
    }
  }

  for (const dim of AMBIGUITY_DIMENSIONS) {
    const allValues = dimValuesSeen.get(dim.qualifierType);
    if (allValues.size < 2) continue; // only one value in play — nothing to disambiguate
    const bySku = dimValuesBySku.get(dim.qualifierType);
    const dimMatters = [...bySku.values()].some((vals) => vals.size < allValues.size);
    if (dimMatters) {
      matchesBySku.clear();
      pendingByType.set(dim.qualifierType, { kind: 'vehicle_field', values: new Map([...allValues].map((v) => [v, v])) });
    }
  }

  const matches = [...matchesBySku.values()];

  // 'qualifier' entries are genuine fitment qualifiers (e.g. leaf vs. coil rear
  // suspension) the customer often can't name unprompted — worth presenting as
  // choices. 'vehicle_field' entries (trim/body style/drive type/engine config)
  // are things the customer already knows about their own vehicle and can just
  // type in response to a normal follow-up question.
  const needsQualifier = [...pendingByType.entries()].map(([qualifierType, { kind, values }]) => ({
    qualifierType,
    kind,
    options: [...values.entries()].map(([value, label]) => ({ value, label })),
  }));

  // A specific part type was requested and nothing matched (not even blocked on a
  // qualifier) — before declaring a dead end, check whether the vehicle matches
  // something under a *different* part type. "No axle-back for your Tacoma, but
  // here's the cat-back we do have" is very different from "nothing fits your truck."
  let otherPartTypeMatches = null;
  if (partType && matches.length === 0 && needsQualifier.length === 0) {
    const withoutPartType = await lookupParts({ year, make, model, submodel, engineLiters, bodyStyle, driveType, engineConfig, partType: null, lifted, qualifiers });
    if (withoutPartType.matches.length > 0) otherPartTypeMatches = withoutPartType.matches;
  }

  return { matches, needsQualifier, otherPartTypeMatches };
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
