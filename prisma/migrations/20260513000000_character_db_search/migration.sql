-- Enable pg_trgm for fuzzy string similarity
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index on character name for fast trigram lookup
CREATE INDEX IF NOT EXISTS idx_characters_name_trgm
  ON characters USING GIN (name gin_trgm_ops);

-- GIN index on shortDescription extracted from the sheet JSONB column
-- Extra parentheses required for expression indexes in PostgreSQL
CREATE INDEX IF NOT EXISTS idx_characters_description_trgm
  ON characters USING GIN ((sheet->>'shortDescription') gin_trgm_ops);
