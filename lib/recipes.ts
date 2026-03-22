import { sql } from "@/lib/db";
import { Recipe, RecipePayload } from "@/types/recipe";

type RecipeRow = {
  id: string;
  name: string;
  ingredients: unknown;
  preparo: string;
  finalizacao: string;
  favorite: boolean | null;
  updated_at: string;
};

export type NormalizedRecipePayload = RecipePayload & { favorite: boolean };

export class RecipeValidationError extends Error {}

let schemaReadyPromise: Promise<void> | null = null;

const ensureRecipesSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
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
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  await schemaReadyPromise;
};

const ensureStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .map((item) => item.replace(/\r/g, ""))
    .filter(Boolean);
};

const mapRowToRecipe = (row: RecipeRow): Recipe => ({
  id: row.id,
  name: row.name,
  ingredients: ensureStringArray(row.ingredients ?? []),
  preparo: row.preparo,
  finalizacao: row.finalizacao,
  favorite: Boolean(row.favorite),
  updatedAt: new Date(row.updated_at).getTime()
});

const sanitizePayload = (input: Partial<RecipePayload>): NormalizedRecipePayload => {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const preparo = typeof input.preparo === "string" ? input.preparo.trim() : "";
  const finalizacao =
    typeof input.finalizacao === "string" ? input.finalizacao.trim() : "";
  const ingredients = Array.isArray(input.ingredients)
    ? input.ingredients.map((item) => String(item).trim()).filter(Boolean)
    : [];

  if (!name) {
    throw new RecipeValidationError("Nome da receita é obrigatório");
  }
  if (!ingredients.length) {
    throw new RecipeValidationError("Inclua pelo menos um ingrediente");
  }
  if (!preparo) {
    throw new RecipeValidationError("Descreva o modo de preparo");
  }
  if (!finalizacao) {
    throw new RecipeValidationError("Descreva a finalização");
  }

  return {
    name,
    ingredients,
    preparo,
    finalizacao,
    favorite: Boolean(input.favorite)
  };
};

export const normalizeIncomingPayload = (payload: unknown): NormalizedRecipePayload => {
  if (!payload || typeof payload !== "object") {
    throw new RecipeValidationError("Estrutura inválida");
  }
  return sanitizePayload(payload as Partial<RecipePayload>);
};

export const listRecipes = async (): Promise<Recipe[]> => {
  await ensureRecipesSchema();
  const rows = (await sql`
    SELECT id, name, ingredients, preparo, finalizacao, favorite, updated_at
    FROM recipes
    ORDER BY favorite DESC, updated_at DESC
  `) as RecipeRow[];
  return rows.map(mapRowToRecipe);
};

export const createRecipeRecord = async (
  payload: NormalizedRecipePayload & { id?: string }
): Promise<Recipe> => {
  await ensureRecipesSchema();
  const recordId = payload.id ?? crypto.randomUUID();
  const [row] = (await sql`
    INSERT INTO recipes (id, name, ingredients, preparo, finalizacao, favorite, updated_at)
    VALUES (
      ${recordId},
      ${payload.name},
      ${JSON.stringify(payload.ingredients)}::jsonb,
      ${payload.preparo},
      ${payload.finalizacao},
      ${payload.favorite},
      now()
    )
    RETURNING id, name, ingredients, preparo, finalizacao, favorite, updated_at
  `) as RecipeRow[];
  return mapRowToRecipe(row);
};

export const updateRecipeRecord = async (
  id: string,
  payload: NormalizedRecipePayload
): Promise<Recipe | null> => {
  await ensureRecipesSchema();
  const rows = (await sql`
    UPDATE recipes
    SET
      name = ${payload.name},
      ingredients = ${JSON.stringify(payload.ingredients)}::jsonb,
      preparo = ${payload.preparo},
      finalizacao = ${payload.finalizacao},
      favorite = ${payload.favorite},
      updated_at = now()
    WHERE id = ${id}
    RETURNING id, name, ingredients, preparo, finalizacao, favorite, updated_at
  `) as RecipeRow[];

  if (!rows.length) {
    return null;
  }

  return mapRowToRecipe(rows[0]);
};

export const touchRecipeRecord = async (id: string): Promise<Recipe | null> => {
  await ensureRecipesSchema();
  const rows = (await sql`
    UPDATE recipes
    SET updated_at = now()
    WHERE id = ${id}
    RETURNING id, name, ingredients, preparo, finalizacao, favorite, updated_at
  `) as RecipeRow[];
  if (!rows.length) {
    return null;
  }
  return mapRowToRecipe(rows[0]);
};

export const deleteRecipeRecord = async (id: string): Promise<boolean> => {
  await ensureRecipesSchema();
  const rows = (await sql`
    DELETE FROM recipes WHERE id = ${id} RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
};
