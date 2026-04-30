import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { PSM, createWorker } from "tesseract.js";
import { z } from "zod";

import { RecipeImportError, parseRecipeText, type ParsedRecipe } from "@/server/importer/parser";
import type { RecipePayload } from "@/types/recipe";

const OPENAI_PROVIDER = "openai";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

const sourceTypeSchema = z.enum(["manual", "manual_title", "image_upload", "camera_capture", "text_import"]);

const recipeCoreSchema = z.object({
  name: z.string(),
  ingredients: z.array(z.string()),
  preparo: z.string(),
  finalizacao: z.string(),
  favorite: z.boolean().default(false)
});

const importInputSchema = z.object({
  text: z.string().default(""),
  titleHint: z.string().default(""),
  imageDataUrl: z.string().nullable().default(null),
  imageMimeType: z.string().nullable().default(null),
  sourceType: sourceTypeSchema.default("text_import")
});

const importDraftSchema = importInputSchema.extend({
  aiProvider: z.string().nullable().default(null),
  aiModel: z.string().nullable().default(null),
  visionRecipe: recipeCoreSchema.nullable().default(null),
  ocrText: z.string().nullable().default(null),
  ocrConfidence: z.number().nullable().default(null),
  processingMetadata: z.record(z.string(), z.unknown()).default({})
});

const workflowResultSchema = recipeCoreSchema.extend({
  sourceType: sourceTypeSchema,
  sourceText: z.string().nullable().default(null),
  sourceTitle: z.string().nullable().default(null),
  aiProvider: z.string().nullable().default(null),
  aiModel: z.string().nullable().default(null),
  processingConfidence: z.number().nullable().default(null),
  reviewRequired: z.boolean().default(false),
  processingMetadata: z.record(z.string(), z.unknown()).nullable().default(null)
});

const generationInputSchema = z.object({
  title: z.string()
});

type ImportInput = z.infer<typeof importInputSchema>;
export type RecipeWorkflowResult = z.infer<typeof workflowResultSchema>;

const getOpenAiModel = () => process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;

const hasOpenAiKey = () => Boolean(process.env.OPENAI_API_KEY?.trim());

const buildMissingOpenAiKeyError = () =>
  new RecipeImportError(
    "OPENAI_API_KEY não foi carregada no servidor. Se você acabou de configurar .env/.env.local, reinicie o Next (`npm run dev`)."
  );

const mapOpenAiError = (error: unknown): RecipeImportError | null => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const maybeError = error as {
    statusCode?: number;
    data?: { error?: { code?: string; message?: string } };
    responseBody?: string;
  };
  const code = maybeError?.data?.error?.code || "";
  const responseBody = typeof maybeError?.responseBody === "string" ? maybeError.responseBody : "";

  if (code === "invalid_api_key" || /Incorrect API key provided/i.test(message) || /invalid_api_key/i.test(responseBody)) {
    return new RecipeImportError(
      "A OPENAI_API_KEY configurada foi rejeitada pela OpenAI. Gere uma nova chave em https://platform.openai.com/api-keys e atualize o .env/.env.local."
    );
  }

  if (maybeError?.statusCode === 401) {
    return new RecipeImportError("A autenticação com a OpenAI falhou. Revise a OPENAI_API_KEY configurada no servidor.");
  }

  if (maybeError?.statusCode === 429) {
    return new RecipeImportError("A OpenAI recusou a requisição por limite de uso. Tente novamente em instantes.");
  }

  return null;
};

const generateWithRecipeAgent = async (messages: Parameters<ReturnType<typeof getRecipeAutomationAgent>["generate"]>[0]) => {
  try {
    return await getRecipeAutomationAgent().generate(messages, {
      structuredOutput: {
        schema: recipeCoreSchema
      }
    });
  } catch (error) {
    const mappedError = mapOpenAiError(error);
    if (mappedError) {
      throw mappedError;
    }

    throw error;
  }
};

const getRecipeAutomationAgent = () =>
  new Agent({
    id: "recipe-automation-agent",
    name: "Recipe Automation Agent",
    instructions: `You transform recipe sources into compact cooking cards.

Rules:
- Always return valid JSON matching the schema.
- Keep the recipe practical and concise.
- Ingredients must be one ingredient per array item.
- "preparo" should be a short, direct cooking instruction.
- "finalizacao" should contain the final step, serving note, resting time, or oven timing when available.
- When extracting from image or OCR, use only what is visible or explicitly provided.
- If a field is uncertain, return the best minimal guess instead of adding long explanations.
- Default "favorite" to false unless the input explicitly asks otherwise.`,
    model: `${OPENAI_PROVIDER}/${getOpenAiModel()}`
  });

const normalizeText = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeIngredients = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((item) =>
      String(item ?? "")
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-•\u2022]\s*/, "").trim())
        .filter(Boolean)
    )
    .filter(Boolean);
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

const decodeDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    throw new RecipeImportError("Imagem inválida para processamento");
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
};

const inferSourceText = (options: { text?: string; ocrText?: string | null; titleHint?: string }) => {
  const ocrText = normalizeText(options.ocrText);
  if (ocrText) {
    return ocrText;
  }

  const text = normalizeText(options.text);
  if (text) {
    return text;
  }

  const titleHint = normalizeText(options.titleHint);
  return titleHint || null;
};

const fillFinalizacaoFromPreparo = (preparo: string, finalizacao: string) => {
  if (finalizacao) {
    return { preparo, finalizacao };
  }

  const sentences = preparo
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length > 1) {
    const lastSentence = sentences.pop() ?? "";
    return {
      preparo: sentences.join(" ").trim(),
      finalizacao: lastSentence.trim()
    };
  }

  return { preparo, finalizacao };
};

const normalizeRecipeCandidate = (candidate: Partial<RecipePayload> | null | undefined): ParsedRecipe | null => {
  if (!candidate) {
    return null;
  }

  const name = normalizeText(candidate.name);
  const ingredients = normalizeIngredients(candidate.ingredients);
  const preparo = normalizeText(candidate.preparo);
  const finalizacao = normalizeText(candidate.finalizacao);
  const completed = fillFinalizacaoFromPreparo(preparo, finalizacao);

  if (!name && !ingredients.length && !completed.preparo && !completed.finalizacao) {
    return null;
  }

  return {
    name,
    ingredients,
    preparo: completed.preparo,
    finalizacao: completed.finalizacao,
    favorite: Boolean(candidate.favorite)
  };
};

const ensureCompleteRecipe = (candidate: Partial<RecipePayload> | null | undefined, fallbackText?: string | null): ParsedRecipe => {
  let recipe = normalizeRecipeCandidate(candidate);

  if (fallbackText) {
    try {
      const parsedFallback = parseRecipeText(fallbackText);
      if (!recipe) {
        recipe = parsedFallback;
      } else {
        recipe = {
          name: recipe.name || parsedFallback.name,
          ingredients: recipe.ingredients.length ? recipe.ingredients : parsedFallback.ingredients,
          preparo: recipe.preparo || parsedFallback.preparo,
          finalizacao: recipe.finalizacao || parsedFallback.finalizacao,
          favorite: recipe.favorite || parsedFallback.favorite
        };
      }
    } catch {
      // Fallback parser is best-effort only.
    }
  }

  if (!recipe?.name) {
    throw new RecipeImportError("Não foi possível identificar o nome da receita");
  }

  if (!recipe.ingredients.length) {
    throw new RecipeImportError("Não foi possível identificar os ingredientes da receita");
  }

  if (!recipe.preparo) {
    throw new RecipeImportError("Não foi possível identificar o preparo da receita");
  }

  if (!recipe.finalizacao) {
    throw new RecipeImportError("Não foi possível identificar a finalização da receita");
  }

  return recipe;
};

const assessRecipeQuality = (
  recipe: ParsedRecipe,
  strategy: "vision" | "vision+ocr" | "text-ai" | "ocr-parser" | "text-parser" | "title-generation",
  sourceText?: string | null
) => {
  const baseConfidence: Record<typeof strategy, number> = {
    vision: 0.94,
    "vision+ocr": 0.87,
    "text-ai": 0.89,
    "ocr-parser": 0.76,
    "text-parser": 0.71,
    "title-generation": 0.83
  };

  let confidence = baseConfidence[strategy];
  const reasons: string[] = [];

  if (recipe.ingredients.length < 2) {
    confidence -= 0.14;
    reasons.push("few_ingredients");
  }

  if (recipe.preparo.length < 24) {
    confidence -= 0.08;
    reasons.push("short_preparo");
  }

  if (recipe.finalizacao.length < 12) {
    confidence -= 0.08;
    reasons.push("short_finalizacao");
  }

  if (/descreva os ingredientes/i.test(recipe.ingredients.join(" "))) {
    confidence -= 0.2;
    reasons.push("placeholder_ingredients");
  }

  if (sourceText && normalizeText(sourceText).length < 20 && strategy !== "title-generation") {
    confidence -= 0.05;
    reasons.push("weak_source_text");
  }

  const normalizedConfidence = clamp(confidence);
  return {
    confidence: normalizedConfidence,
    reviewRequired: normalizedConfidence < 0.78 || reasons.includes("placeholder_ingredients"),
    reasons
  };
};

const parseRecipeFromTextWithAgent = async (text: string, titleHint?: string): Promise<ParsedRecipe | null> => {
  if (!hasOpenAiKey() || !normalizeText(text)) {
    return null;
  }

  const response = await generateWithRecipeAgent([
    {
      role: "user",
      content: `Estruture a receita abaixo para o formato do app.

${titleHint ? `Título sugerido: ${titleHint}\n\n` : ""}Texto bruto:
${text}`
    }
  ]);

  return normalizeRecipeCandidate(response.object);
};

const parseRecipeFromImageWithAgent = async (input: ImportInput): Promise<ParsedRecipe | null> => {
  if (!hasOpenAiKey() || !input.imageDataUrl) {
    return null;
  }

  const response = await generateWithRecipeAgent([
    {
      role: "user",
      content: [
        {
          type: "image",
          image: input.imageDataUrl,
          mimeType: input.imageMimeType || "image/jpeg"
        },
        {
          type: "text",
          text: `Leia a imagem e extraia a receita no formato do app.

${input.titleHint ? `Título sugerido pelo usuário: ${input.titleHint}\n` : ""}${
            normalizeText(input.text) ? `Contexto digitado pelo usuário:\n${normalizeText(input.text)}` : ""
          }`
        }
      ]
    }
  ]);

  return normalizeRecipeCandidate(response.object);
};

const generateRecipeFromTitleWithAgent = async (title: string): Promise<ParsedRecipe> => {
  if (!hasOpenAiKey()) {
    throw buildMissingOpenAiKeyError();
  }

  const trimmedTitle = normalizeText(title);
  if (!trimmedTitle) {
    throw new RecipeImportError("Informe o título da receita para gerar");
  }

  const response = await generateWithRecipeAgent([
    {
      role: "user",
      content: `Gere uma receita doméstica prática com base apenas no título "${trimmedTitle}".

Requisitos:
- Receita objetiva e plausível.
- Ingredientes completos em lista.
- Preparo curto e claro.
- Finalização com servir, descanso ou tempo/temperatura quando fizer sentido.`
    }
  ]);

  return ensureCompleteRecipe(response.object, trimmedTitle);
};

const buildGeneratedRecipeResult = async (title: string): Promise<RecipeWorkflowResult> => {
  const parsed = generationInputSchema.parse({ title });
  const recipe = await generateRecipeFromTitleWithAgent(parsed.title);
  const quality = assessRecipeQuality(recipe, "title-generation", parsed.title);

  return {
    ...recipe,
    favorite: Boolean(recipe.favorite),
    sourceType: "manual_title",
    sourceText: parsed.title.trim(),
    sourceTitle: parsed.title.trim(),
    aiProvider: OPENAI_PROVIDER,
    aiModel: getOpenAiModel(),
    processingConfidence: quality.confidence,
    reviewRequired: quality.reviewRequired,
    processingMetadata: {
      pipeline: "recipe-generation-workflow",
      strategy: "title-generation",
      qualitySignals: quality.reasons
    }
  };
};

const runOcrFallback = async (imageDataUrl: string) => {
  const { buffer } = decodeDataUrl(imageDataUrl);
  const worker = await createWorker("por+eng", 1);

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300"
    });

    const result = await worker.recognize(
      buffer,
      { rotateAuto: true },
      {
        text: true,
        blocks: true
      }
    );

    return {
      text: normalizeText(result.data.text),
      confidence:
        typeof result.data.confidence === "number" && Number.isFinite(result.data.confidence)
          ? clamp(result.data.confidence / 100)
          : null
    };
  } finally {
    await worker.terminate();
  }
};

const importVisionStep = createStep({
  id: "recipe-import-vision",
  inputSchema: importInputSchema,
  outputSchema: importDraftSchema,
  execute: async ({ inputData }) => {
    const processingMetadata: Record<string, unknown> = {
      pipeline: "recipe-ingestion-workflow",
      sourceType: inputData.sourceType,
      usedVision: false
    };

    if (!inputData.imageDataUrl) {
      return {
        ...inputData,
        aiProvider: hasOpenAiKey() ? OPENAI_PROVIDER : null,
        aiModel: hasOpenAiKey() ? getOpenAiModel() : null,
        visionRecipe: null,
        ocrText: null,
        ocrConfidence: null,
        processingMetadata
      };
    }

    if (!hasOpenAiKey()) {
      return {
        ...inputData,
        aiProvider: null,
        aiModel: null,
        visionRecipe: null,
        ocrText: null,
        ocrConfidence: null,
        processingMetadata: {
          ...processingMetadata,
          visionSkipped: "missing_openai_key"
        }
      };
    }

    try {
      const recipe = await parseRecipeFromImageWithAgent(inputData);

      return {
        ...inputData,
        aiProvider: OPENAI_PROVIDER,
        aiModel: getOpenAiModel(),
        visionRecipe: recipe,
        ocrText: null,
        ocrConfidence: null,
        processingMetadata: {
          ...processingMetadata,
          usedVision: true
        }
      };
    } catch (error) {
      console.error("recipe import: vision step failed", error);
      return {
        ...inputData,
        aiProvider: OPENAI_PROVIDER,
        aiModel: getOpenAiModel(),
        visionRecipe: null,
        ocrText: null,
        ocrConfidence: null,
        processingMetadata: {
          ...processingMetadata,
          usedVision: true,
          visionError: error instanceof Error ? error.message : "unknown"
        }
      };
    }
  }
});

const importOcrStep = createStep({
  id: "recipe-import-ocr",
  inputSchema: importDraftSchema,
  outputSchema: importDraftSchema,
  execute: async ({ inputData }) => {
    if (!inputData.imageDataUrl) {
      return inputData;
    }

    const visionRecipe = normalizeRecipeCandidate(inputData.visionRecipe);
    if (visionRecipe?.name && visionRecipe.ingredients.length && visionRecipe.preparo && visionRecipe.finalizacao) {
      return {
        ...inputData,
        processingMetadata: {
          ...inputData.processingMetadata,
          usedOcrFallback: false
        }
      };
    }

    try {
      const ocr = await runOcrFallback(inputData.imageDataUrl);

      return {
        ...inputData,
        ocrText: ocr.text || null,
        ocrConfidence: ocr.confidence,
        processingMetadata: {
          ...inputData.processingMetadata,
          usedOcrFallback: true
        }
      };
    } catch (error) {
      console.error("recipe import: OCR step failed", error);
      return {
        ...inputData,
        ocrText: null,
        ocrConfidence: null,
        processingMetadata: {
          ...inputData.processingMetadata,
          usedOcrFallback: true,
          ocrError: error instanceof Error ? error.message : "unknown"
        }
      };
    }
  }
});

const finalizeImportStep = createStep({
  id: "recipe-import-finalize",
  inputSchema: importDraftSchema,
  outputSchema: workflowResultSchema,
  execute: async ({ inputData }) => {
    const sourceText = inferSourceText({
      text: inputData.text,
      ocrText: inputData.ocrText,
      titleHint: inputData.titleHint
    });

    let strategy: "vision" | "vision+ocr" | "text-ai" | "ocr-parser" | "text-parser" = "text-parser";
    let candidate = normalizeRecipeCandidate(inputData.visionRecipe);

    if (!candidate && inputData.ocrText && hasOpenAiKey()) {
      strategy = "vision+ocr";
      candidate = await parseRecipeFromTextWithAgent(inputData.ocrText, inputData.titleHint);
    } else if (!candidate && normalizeText(inputData.text) && hasOpenAiKey()) {
      strategy = "text-ai";
      candidate = await parseRecipeFromTextWithAgent(inputData.text, inputData.titleHint);
    } else if (candidate && inputData.ocrText) {
      strategy = "vision+ocr";
    } else if (candidate) {
      strategy = "vision";
    } else if (inputData.ocrText) {
      strategy = "ocr-parser";
    }

    const recipe = ensureCompleteRecipe(candidate, sourceText);
    const quality = assessRecipeQuality(recipe, strategy, sourceText);

    return {
      ...recipe,
      sourceType: inputData.sourceType,
      sourceText,
      sourceTitle: normalizeText(inputData.titleHint) || null,
      aiProvider: inputData.aiProvider,
      aiModel: inputData.aiModel,
      processingConfidence:
        inputData.ocrConfidence !== null && strategy === "ocr-parser"
          ? clamp((quality.confidence + inputData.ocrConfidence) / 2)
          : quality.confidence,
      reviewRequired: quality.reviewRequired,
      processingMetadata: {
        ...inputData.processingMetadata,
        strategy,
        qualitySignals: quality.reasons,
        ocrConfidence: inputData.ocrConfidence
      }
    };
  }
});

const generationStep = createStep({
  id: "recipe-generate-from-title",
  inputSchema: generationInputSchema,
  outputSchema: workflowResultSchema,
  execute: async ({ inputData }) => buildGeneratedRecipeResult(inputData.title)
});

export const recipeIngestionWorkflow = createWorkflow({
  id: "recipe-ingestion-workflow",
  inputSchema: importInputSchema,
  outputSchema: workflowResultSchema
})
  .then(importVisionStep)
  .then(importOcrStep)
  .then(finalizeImportStep)
  .commit();

export const recipeGenerationWorkflow = createWorkflow({
  id: "recipe-generation-workflow",
  inputSchema: generationInputSchema,
  outputSchema: workflowResultSchema
})
  .then(generationStep)
  .commit();

export const mastra = new Mastra({
  agents: {},
  workflows: { recipeIngestionWorkflow, recipeGenerationWorkflow }
});

const runWorkflow = async <TInput extends object>(
  workflowKey: "recipeIngestionWorkflow" | "recipeGenerationWorkflow",
  inputData: TInput
) => {
  const workflow = mastra.getWorkflow(workflowKey);
  if (!workflow) {
    throw new Error(`Workflow '${workflowKey}' não encontrado`);
  }

  const run = await workflow.createRun();
  const result = await run.start({ inputData });

  if (result.status === "failed") {
    const workflowError = result.error;

    if (workflowError instanceof RecipeImportError) {
      throw workflowError;
    }

    const workflowMessage = workflowError instanceof Error ? workflowError.message : String(workflowError ?? "");

    if (/OPENAI_API_KEY/i.test(workflowMessage)) {
      throw buildMissingOpenAiKeyError();
    }

    throw workflowError instanceof Error
      ? workflowError
      : new Error(`Workflow '${workflowKey}' falhou com status ${result.status}`);
  }

  if (result.status !== "success") {
    throw new RecipeImportError("O workflow de receita não conseguiu concluir a resposta do modelo");
  }

  return result.result;
};

export const runRecipeImportWorkflow = async (input: ImportInput): Promise<RecipeWorkflowResult> =>
  (await runWorkflow("recipeIngestionWorkflow", importInputSchema.parse(input))) as RecipeWorkflowResult;

export const runRecipeGenerationWorkflow = async (title: string): Promise<RecipeWorkflowResult> => {
  if (!hasOpenAiKey()) {
    throw buildMissingOpenAiKeyError();
  }

  return await buildGeneratedRecipeResult(title);
};
