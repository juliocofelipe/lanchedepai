import type { RecipePayload, RecipeProcessingMetadata, RecipeSourceType } from "@/types/recipe";

export type NormalizedRecipePayload = RecipePayload & { favorite: boolean; reviewRequired: boolean };

export class RecipeValidationError extends Error {}

const ALLOWED_SOURCE_TYPES: RecipeSourceType[] = ["manual", "manual_title", "image_upload", "camera_capture", "text_import"];

const normalizeSourceType = (value: unknown): RecipeSourceType | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  return ALLOWED_SOURCE_TYPES.includes(value as RecipeSourceType) ? (value as RecipeSourceType) : undefined;
};

const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeProcessingConfidence = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
};

const normalizeProcessingMetadata = (value: unknown): RecipeProcessingMetadata | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as RecipeProcessingMetadata;
};

const sanitizePayload = (input: Partial<RecipePayload>): NormalizedRecipePayload => {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const preparo = typeof input.preparo === "string" ? input.preparo.trim() : "";
  const finalizacao = typeof input.finalizacao === "string" ? input.finalizacao.trim() : "";
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
    favorite: Boolean(input.favorite),
    sourceType: normalizeSourceType(input.sourceType) ?? "manual",
    sourceText: normalizeOptionalText(input.sourceText),
    sourceTitle: normalizeOptionalText(input.sourceTitle),
    aiProvider: normalizeOptionalText(input.aiProvider),
    aiModel: normalizeOptionalText(input.aiModel),
    processingConfidence: normalizeProcessingConfidence(input.processingConfidence),
    reviewRequired: Boolean(input.reviewRequired),
    processingMetadata: normalizeProcessingMetadata(input.processingMetadata)
  };
};

export const normalizeIncomingPayload = (payload: unknown): NormalizedRecipePayload => {
  if (!payload || typeof payload !== "object") {
    throw new RecipeValidationError("Estrutura inválida");
  }
  return sanitizePayload(payload as Partial<RecipePayload>);
};
