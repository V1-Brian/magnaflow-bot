-- Additive migration for an already-provisioned database (e.g. the live Render Postgres).
-- schema.sql is CREATE TABLE-only and fails on a DB that already has the original tables,
-- so run this file instead to bring an existing install up to date. Safe to re-run.

CREATE TABLE IF NOT EXISTS qualifiers (
  id              SERIAL PRIMARY KEY,
  qualifier_type  VARCHAR(64) NOT NULL,
  qualifier_value VARCHAR(64) NOT NULL,
  label           VARCHAR(128) NOT NULL,
  UNIQUE(qualifier_type, qualifier_value)
);

CREATE TABLE IF NOT EXISTS fitment_qualifiers (
  fitment_id   INTEGER REFERENCES fitment(id) ON DELETE CASCADE,
  qualifier_id INTEGER REFERENCES qualifiers(id) ON DELETE CASCADE,
  PRIMARY KEY (fitment_id, qualifier_id)
);

CREATE TABLE IF NOT EXISTS recommendation_log (
  id           SERIAL PRIMARY KEY,
  year         INTEGER,
  make         VARCHAR(64),
  model        VARCHAR(64),
  submodel     VARCHAR(128),
  engine_liters NUMERIC(3,1),
  qualifiers   JSONB,
  skus         VARCHAR(32)[] NOT NULL,
  checked_at   TIMESTAMPTZ,
  check_result JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fitment_qualifiers_fitment ON fitment_qualifiers(fitment_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_log_unchecked ON recommendation_log(checked_at) WHERE checked_at IS NULL;

-- Older installs may have duplicate (part_id, attr_key) rows from the pre-constraint seed.js;
-- keep only the most recent row per key before adding the constraint.
DELETE FROM part_attributes pa
  USING part_attributes pa2
  WHERE pa.part_id = pa2.part_id
    AND pa.attr_key = pa2.attr_key
    AND pa.id < pa2.id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'part_attributes_part_id_attr_key_key'
  ) THEN
    ALTER TABLE part_attributes ADD CONSTRAINT part_attributes_part_id_attr_key_key UNIQUE (part_id, attr_key);
  END IF;
END $$;

-- Newer engine descriptions (e.g. hybrid powertrain names) exceed the original 32-char limit.
ALTER TABLE vehicles ALTER COLUMN engine_config TYPE VARCHAR(64);
