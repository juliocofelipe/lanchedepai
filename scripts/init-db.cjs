const { neon } = require("@neondatabase/serverless");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL não configurada");
}

const sql = neon(connectionString);

const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ingredients JSONB NOT NULL,
      preparo TEXT NOT NULL,
      finalizacao TEXT NOT NULL,
      favorite BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS favorite BOOLEAN DEFAULT FALSE
  `,
  `
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `,
  `
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS source_type TEXT
  `,
  `
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS source_text TEXT
  `,
  `
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS source_title TEXT
  `,
  `
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS ai_provider TEXT
  `,
  `
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS ai_model TEXT
  `,
  `
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS processing_confidence DOUBLE PRECISION
  `,
  `
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS review_required BOOLEAN NOT NULL DEFAULT FALSE
  `,
  `
    ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS processing_metadata JSONB
  `,
  `
    CREATE INDEX IF NOT EXISTS recipes_sort_idx
    ON recipes (favorite DESC, updated_at DESC)
  `,
  `
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    )
  `,
  `
    ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE
  `,
  `
    ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `,
  `
    ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `,
  `
    ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_idx
    ON auth_users (LOWER(email))
  `,
  `
    CREATE TABLE IF NOT EXISTS auth_password_resets (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    ALTER TABLE auth_password_resets
    ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ
  `,
  `
    ALTER TABLE auth_password_resets
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `,
  `
    CREATE INDEX IF NOT EXISTS auth_password_resets_email_idx
    ON auth_password_resets (LOWER(email))
  `
];

async function main() {
  for (const statement of schemaStatements) {
    await sql.query(statement);
  }

  const tables = await sql.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('recipes', 'auth_users', 'auth_password_resets')
    ORDER BY table_name
  `);

  console.log("Tabelas prontas:", tables.map((row) => row.table_name).join(", "));
}

main().catch((error) => {
  console.error("Falha ao inicializar o banco.");
  console.error(error);
  process.exitCode = 1;
});
