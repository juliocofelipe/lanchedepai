import type { Recipe, RecipeProcessingMetadata, RecipeSourceType } from "@/types/recipe";

export type RecipeFormState = {
  id?: string;
  name: string;
  ingredientsText: string;
  preparo: string;
  finalizacao: string;
  favorite: boolean;
  sourceType?: RecipeSourceType;
  sourceText?: string | null;
  sourceTitle?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  processingConfidence?: number | null;
  reviewRequired?: boolean;
  processingMetadata?: RecipeProcessingMetadata | null;
};

export const emptyFormState = (): RecipeFormState => ({
  name: "",
  ingredientsText: "",
  preparo: "",
  finalizacao: "",
  favorite: false,
  sourceType: "manual",
  sourceText: null,
  sourceTitle: null,
  aiProvider: null,
  aiModel: null,
  processingConfidence: null,
  reviewRequired: false,
  processingMetadata: null
});

export const toFormState = (recipe?: Recipe): RecipeFormState =>
  recipe
    ? {
        id: recipe.id,
        name: recipe.name,
        ingredientsText: (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).join("\n"),
        preparo: recipe.preparo,
        finalizacao: recipe.finalizacao,
        favorite: Boolean(recipe.favorite),
        sourceType: recipe.sourceType,
        sourceText: recipe.sourceText ?? null,
        sourceTitle: recipe.sourceTitle ?? null,
        aiProvider: recipe.aiProvider ?? null,
        aiModel: recipe.aiModel ?? null,
        processingConfidence: recipe.processingConfidence ?? null,
        reviewRequired: Boolean(recipe.reviewRequired),
        processingMetadata: recipe.processingMetadata ?? null
      }
    : emptyFormState();
