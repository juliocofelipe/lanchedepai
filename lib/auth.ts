import bcrypt from "bcryptjs";

import { sql } from "@/lib/db";

type AuthUserRow = {
  id: string;
  email: string;
  password_hash: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

type PasswordResetRow = {
  token: string;
  email: string;
  expires_at: string;
  used_at: string | null;
};

export type AuthUser = {
  id: string;
  email: string;
  active: boolean;
  createdAt: number;
  lastLoginAt: number | null;
};

let authSchemaPromise: Promise<void> | null = null;
const PASSWORD_RESET_EXPIRATION_MINUTES = 30;

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const mapRowToUser = (row: Pick<AuthUserRow, "id" | "email" | "active" | "created_at" | "last_login_at">): AuthUser => ({
  id: row.id,
  email: row.email,
  active: row.active,
  createdAt: new Date(row.created_at).getTime(),
  lastLoginAt: row.last_login_at ? new Date(row.last_login_at).getTime() : null
});

const ensureAuthSchema = async () => {
  if (!authSchemaPromise) {
    authSchemaPromise = (async () => {
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
        CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_idx ON auth_users (LOWER(email))
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
        CREATE INDEX IF NOT EXISTS auth_password_resets_email_idx ON auth_password_resets (LOWER(email))
      `;
    })().catch((error) => {
      authSchemaPromise = null;
      throw error;
    });
  }

  await authSchemaPromise;
};

export const createAuthUser = async (email: string, password: string): Promise<AuthUser> => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Email é obrigatório");
  }
  if (!password || password.length < 6) {
    throw new Error("Senha deve ter ao menos 6 caracteres");
  }

  await ensureAuthSchema();
  const passwordHash = await bcrypt.hash(password, Number(process.env.HASH_ROUNDS ?? 12));
  const recordId = crypto.randomUUID();

  const rows = (await sql`
    INSERT INTO auth_users (id, email, password_hash, active)
    VALUES (${recordId}, ${normalizedEmail}, ${passwordHash}, TRUE)
    ON CONFLICT (email)
    DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = NOW(), active = TRUE
    RETURNING id, email, active, created_at, last_login_at
  `) as Pick<AuthUserRow, "id" | "email" | "active" | "created_at" | "last_login_at">[];

  return mapRowToUser(rows[0]);
};

export const authenticateUser = async (email: string, password: string): Promise<AuthUser | null> => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    return null;
  }

  await ensureAuthSchema();

  const rows = (await sql`
    SELECT id, email, password_hash, active, created_at, last_login_at
    FROM auth_users
    WHERE LOWER(email) = ${normalizedEmail} AND active = TRUE
    LIMIT 1
  `) as AuthUserRow[];

  if (!rows.length) {
    return null;
  }

  const [userRow] = rows;
  const matches = await bcrypt.compare(password, userRow.password_hash || "");
  if (!matches) {
    return null;
  }

  const updates = (await sql`
    UPDATE auth_users
    SET last_login_at = NOW(), updated_at = NOW()
    WHERE id = ${userRow.id}
    RETURNING id, email, active, created_at, last_login_at
  `) as Pick<AuthUserRow, "id" | "email" | "active" | "created_at" | "last_login_at">[];

  return mapRowToUser(updates[0] ?? userRow);
};

const generateResetToken = () => crypto.randomUUID().replace(/-/g, "");

export const createPasswordResetToken = async (email: string) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Email é obrigatório");
  }

  await ensureAuthSchema();

  const userRows = (await sql`
    SELECT id FROM auth_users WHERE LOWER(email) = ${normalizedEmail} AND active = TRUE LIMIT 1
  `) as { id: string }[];

  if (!userRows.length) {
    throw new Error("Usuário não encontrado");
  }

  const token = generateResetToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRATION_MINUTES * 60 * 1000);

  await sql`
    INSERT INTO auth_password_resets (token, email, expires_at)
    VALUES (${token}, ${normalizedEmail}, ${expiresAt.toISOString()})
  `;

  return { token, email: normalizedEmail, expiresAt: expiresAt.getTime() };
};

export const resetPasswordWithToken = async (token: string, password: string): Promise<AuthUser> => {
  if (!token || !password) {
    throw new Error("Token e nova senha são obrigatórios");
  }

  await ensureAuthSchema();

  const [resetRow] = (await sql`
    SELECT token, email, expires_at, used_at
    FROM auth_password_resets
    WHERE token = ${token}
    LIMIT 1
  `) as PasswordResetRow[];

  if (!resetRow) {
    throw new Error("Token inválido");
  }

  if (resetRow.used_at) {
    throw new Error("Token já utilizado");
  }

  if (new Date(resetRow.expires_at).getTime() < Date.now()) {
    throw new Error("Token expirado");
  }

  const normalizedEmail = normalizeEmail(resetRow.email);

  const userRows = (await sql`
    SELECT id FROM auth_users WHERE LOWER(email) = ${normalizedEmail} AND active = TRUE LIMIT 1
  `) as { id: string }[];

  if (!userRows.length) {
    throw new Error("Usuário não encontrado");
  }

  const passwordHash = await bcrypt.hash(password, Number(process.env.HASH_ROUNDS ?? 12));

  await sql`
    UPDATE auth_users
    SET password_hash = ${passwordHash}, updated_at = now()
    WHERE id = ${userRows[0].id}
  `;

  await sql`
    UPDATE auth_password_resets
    SET used_at = now()
    WHERE token = ${token}
  `;

  const [updated] = (await sql`
    SELECT id, email, active, created_at, last_login_at
    FROM auth_users
    WHERE id = ${userRows[0].id}
  `) as Pick<AuthUserRow, "id" | "email" | "active" | "created_at" | "last_login_at">[];

  if (!updated) {
    throw new Error("Usuário não encontrado");
  }

  return mapRowToUser(updated);
};
