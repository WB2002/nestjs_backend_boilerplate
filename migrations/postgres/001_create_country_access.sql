-- Create country_access table for ISO 3166-1 alpha-2 access control.
CREATE TABLE IF NOT EXISTS country_access (
  country_code CHAR(2) PRIMARY KEY,
  enabled BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT country_access_country_code_alpha2_chk
    CHECK (country_code ~ '^[A-Z]{2}$')
);

CREATE INDEX IF NOT EXISTS idx_country_access_enabled
  ON country_access (enabled)
  WHERE enabled = TRUE;
