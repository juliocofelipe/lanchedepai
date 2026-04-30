export type RecipeSourceType = "manual" | "manual_title" | "image_upload" | "camera_capture" | "text_import";

export type RecipeProcessingMetadata = Record<string, unknown>;

export type Recipe = {
  id: string;
  name: string;
  ingredients: string[];
  preparo: string;
  finalizacao: string;
  favorite?: boolean;
  sourceType?: RecipeSourceType;
  sourceText?: string | null;
  sourceTitle?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  processingConfidence?: number | null;
  reviewRequired?: boolean;
  processingMetadata?: RecipeProcessingMetadata | null;
  updatedAt: number;
};

export type RecipePayload = {
  name: string;
  ingredients: string[];
  preparo: string;
  finalizacao: string;
  favorite?: boolean;
  sourceType?: RecipeSourceType;
  sourceText?: string | null;
  sourceTitle?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  processingConfidence?: number | null;
  reviewRequired?: boolean;
  processingMetadata?: RecipeProcessingMetadata | null;
};
