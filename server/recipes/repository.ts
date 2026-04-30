import { sql } from "@/server/db/client";
import { ensureDatabaseSchema } from "@/server/db/schema";
import type { Recipe, RecipeProcessingMetadata, RecipeSourceType } from "@/types/recipe";

import type { NormalizedRecipePayload } from "./validation";

type RecipeRow = {
  id: string;
  name: string;
  ingredients: unknown;
  preparo: string;
  finalizacao: string;
  favorite: boolean | null;
  source_type: RecipeSourceType | null;
  source_text: string | null;
  source_title: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  processing_confidence: number | null;
  review_required: boolean | null;
  processing_metadata: unknown;
  updated_at: string;
};

const ensureStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .map((item) => item.replace(/\r/g, ""))
    .filter(Boolean);
};

const ensureProcessingMetadata = (value: unknown): RecipeProcessingMetadata | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as RecipeProcessingMetadata;
};

const mapRowToRecipe = (row: RecipeRow): Recipe => ({
  id: row.id,
  name: row.name,
  ingredients: ensureStringArray(row.ingredients ?? []),
  preparo: row.preparo,
  finalizacao: row.finalizacao,
  favorite: Boolean(row.favorite),
  sourceType: row.source_type ?? undefined,
  sourceText: row.source_text,
  sourceTitle: row.source_title,
  aiProvider: row.ai_provider,
  aiModel: row.ai_model,
  processingConfidence: typeof row.processing_confidence === "number" ? row.processing_confidence : null,
  reviewRequired: Boolean(row.review_required),
  processingMetadata: ensureProcessingMetadata(row.processing_metadata),
  updatedAt: new Date(row.updated_at).getTime()
});

export const listRecipes = async (): Promise<Recipe[]> => {
  await ensureDatabaseSchema();
  const rows = (await sql`
    SELECT
      id,
      name,
      ingredients,
      preparo,
      finalizacao,
      favorite,
      source_type,
      source_text,
      source_title,
      ai_provider,
      ai_model,
      processing_confidence,
      review_required,
      processing_metadata,
      updated_at
    FROM recipes
    ORDER BY favorite DESC, updated_at DESC
  `) as RecipeRow[];
  return rows.map(mapRowToRecipe);
};

export const createRecipeRecord = async (
  payload: NormalizedRecipePayload & { id?: string }
): Promise<Recipe> => {
  await ensureDatabaseSchema();
  const recordId = payload.id ?? crypto.randomUUID();
  const [row] = (await sql`
    INSERT INTO recipes (
      id,
      name,
      ingredients,
      preparo,
      finalizacao,
      favorite,
      source_type,
      source_text,
      source_title,
      ai_provider,
      ai_model,
      processing_confidence,
      review_required,
      processing_metadata,
      updated_at
    )
    VALUES (
      ${recordId},
      ${payload.name},
      ${JSON.stringify(payload.ingredients)}::jsonb,
      ${payload.preparo},
      ${payload.finalizacao},
      ${payload.favorite},
      ${payload.sourceType ?? null},
      ${payload.sourceText ?? null},
      ${payload.sourceTitle ?? null},
      ${payload.aiProvider ?? null},
      ${payload.aiModel ?? null},
      ${payload.processingConfidence ?? null},
      ${payload.reviewRequired},
      ${payload.processingMetadata ? JSON.stringify(payload.processingMetadata) : null}::jsonb,
      now()
    )
    RETURNING
      id,
      name,
      ingredients,
      preparo,
      finalizacao,
      favorite,
      source_type,
      source_text,
      source_title,
      ai_provider,
      ai_model,
      processing_confidence,
      review_required,
      processing_metadata,
      updated_at
  `) as RecipeRow[];
  return mapRowToRecipe(row);
};

export const updateRecipeRecord = async (
  id: string,
  payload: NormalizedRecipePayload
): Promise<Recipe | null> => {
  await ensureDatabaseSchema();
  const rows = (await sql`
    UPDATE recipes
    SET
      name = ${payload.name},
      ingredients = ${JSON.stringify(payload.ingredients)}::jsonb,
      preparo = ${payload.preparo},
      finalizacao = ${payload.finalizacao},
      favorite = ${payload.favorite},
      source_type = ${payload.sourceType ?? null},
      source_text = ${payload.sourceText ?? null},
      source_title = ${payload.sourceTitle ?? null},
      ai_provider = ${payload.aiProvider ?? null},
      ai_model = ${payload.aiModel ?? null},
      processing_confidence = ${payload.processingConfidence ?? null},
      review_required = ${payload.reviewRequired},
      processing_metadata = ${payload.processingMetadata ? JSON.stringify(payload.processingMetadata) : null}::jsonb,
      updated_at = now()
    WHERE id = ${id}
    RETURNING
      id,
      name,
      ingredients,
      preparo,
      finalizacao,
      favorite,
      source_type,
      source_text,
      source_title,
      ai_provider,
      ai_model,
      processing_confidence,
      review_required,
      processing_metadata,
      updated_at
  `) as RecipeRow[];

  if (!rows.length) {
    return null;
  }

  return mapRowToRecipe(rows[0]);
};

export const touchRecipeRecord = async (id: string): Promise<Recipe | null> => {
  await ensureDatabaseSchema();
  const rows = (await sql`
    UPDATE recipes
    SET updated_at = now()
    WHERE id = ${id}
    RETURNING
      id,
      name,
      ingredients,
      preparo,
      finalizacao,
      favorite,
      source_type,
      source_text,
      source_title,
      ai_provider,
      ai_model,
      processing_confidence,
      review_required,
      processing_metadata,
      updated_at
  `) as RecipeRow[];
  if (!rows.length) {
    return null;
  }
  return mapRowToRecipe(rows[0]);
};

export const deleteRecipeRecord = async (id: string): Promise<boolean> => {
  await ensureDatabaseSchema();
  const rows = (await sql`
    DELETE FROM recipes WHERE id = ${id} RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
};
