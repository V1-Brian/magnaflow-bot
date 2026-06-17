-- Vehicles table
-- Populated by seed.js (demo) or import-aces.js (full ACES import)
CREATE TABLE vehicles (
  id            SERIAL PRIMARY KEY,
  year          INTEGER NOT NULL,
  make          VARCHAR(64) NOT NULL,
  model         VARCHAR(64) NOT NULL,
  submodel      VARCHAR(128),
  engine_liters NUMERIC(3,1),
  engine_config VARCHAR(32),
  body_style    VARCHAR(64),
  drive_type    VARCHAR(16),
  source        VARCHAR(16) DEFAULT 'manual',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Parts table
-- Populated by seed.js (demo) or import-aces.js (full PIES import)
CREATE TABLE parts (
  id                  SERIAL PRIMARY KEY,
  sku                 VARCHAR(32) UNIQUE NOT NULL,
  series              VARCHAR(64),
  part_type           VARCHAR(64),
  description         TEXT,
  price               NUMERIC(8,2),
  product_url         VARCHAR(512),
  sound_level         VARCHAR(32),
  install_difficulty  VARCHAR(32),
  emissions_standard  VARCHAR(16),
  state_restrictions  TEXT[],
  is_lifted_compatible BOOLEAN DEFAULT TRUE,
  source              VARCHAR(16) DEFAULT 'manual',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Fitment join table
-- ACES data model: one vehicle can fit many parts, one part can fit many vehicles
CREATE TABLE fitment (
  id          SERIAL PRIMARY KEY,
  vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  part_id     INTEGER REFERENCES parts(id) ON DELETE CASCADE,
  notes       TEXT,
  source      VARCHAR(16) DEFAULT 'manual',
  UNIQUE(vehicle_id, part_id)
);

-- Part attributes table (PIES extended data)
-- Stores pipe diameter, tip size, exit config, dyno HP gains, etc.
CREATE TABLE part_attributes (
  id        SERIAL PRIMARY KEY,
  part_id   INTEGER REFERENCES parts(id) ON DELETE CASCADE,
  attr_key  VARCHAR(64) NOT NULL,
  attr_val  TEXT NOT NULL
);

-- Indexes for fast vehicle lookups
CREATE INDEX idx_vehicles_ymm ON vehicles(year, make, model);
CREATE INDEX idx_vehicles_engine ON vehicles(engine_liters, engine_config);
CREATE INDEX idx_fitment_vehicle ON fitment(vehicle_id);
CREATE INDEX idx_fitment_part ON fitment(part_id);
CREATE INDEX idx_parts_sku ON parts(sku);
CREATE INDEX idx_parts_type ON parts(part_type);
