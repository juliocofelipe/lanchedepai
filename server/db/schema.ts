import { sql } from "./client";

let schemaReadyPromise: Promise<void> | null = null;

const applyDatabaseSchema = async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ingredients JSONB NOT NULL,
      preparo TEXT NOT NULL,
      finalizacao TEXT NOT NULL,
      favorite BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS favorite BOOLEAN DEFAULT FALSE
  `;

  await sql`
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `;

  await sql`
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS source_type TEXT
  `;

  await sql`
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS source_text TEXT
  `;

  await sql`
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS source_title TEXT
  `;

  await sql`
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS ai_provider TEXT
  `;

  await sql`
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS ai_model TEXT
  `;

  await sql`
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS processing_confidence DOUBLE PRECISION
  `;

  await sql`
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS review_required BOOLEAN NOT NULL DEFAULT FALSE
  `;

  await sql`
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS processing_metadata JSONB
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS recipes_sort_idx
    ON recipes (favorite DESC, updated_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    )
  `;

  await sql`
    ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE
  `;

  await sql`
    ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `;

  await sql`
    ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `;

  await sql`
    ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_idx
    ON auth_users (LOWER(email))
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS auth_password_resets (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    ALTER TABLE auth_password_resets
    ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ
  `;

  await sql`
    ALTER TABLE auth_password_resets
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS auth_password_resets_email_idx
    ON auth_password_resets (LOWER(email))
  `;
};

export const ensureDatabaseSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = applyDatabaseSchema().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  await schemaReadyPromise;
};
