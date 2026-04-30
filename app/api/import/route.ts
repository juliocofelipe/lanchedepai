import { NextResponse } from "next/server";

import { RecipeImportError } from "@/server/importer/parser";
import { runRecipeImportWorkflow } from "@/server/recipes/agentic";
import type { RecipeSourceType } from "@/types/recipe";

export const runtime = "nodejs";

type JsonImportPayload = {
  text?: string;
  titleHint?: string;
  sourceType?: RecipeSourceType;
  imageDataUrl?: string;
  imageMimeType?: string;
};

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeSourceType = (value: unknown): RecipeSourceType => {
  switch (value) {
    case "camera_capture":
    case "image_upload":
    case "manual":
    case "manual_title":
    case "text_import":
      return value;
    default:
      return "text_import";
  }
};

const fileToDataUrl = async (file: File) => {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "image/jpeg";

  return {
    imageDataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    imageMimeType: mimeType
  };
};

const parseMultipartRequest = async (request: Request) => {
  const formData = await request.formData();
  const imageEntry = formData.get("image");
  const imageFile = imageEntry instanceof File && imageEntry.size > 0 ? imageEntry : null;
  const imagePayload = imageFile ? await fileToDataUrl(imageFile) : { imageDataUrl: null, imageMimeType: null };

  return {
    text: normalizeText(formData.get("text")),
    titleHint: normalizeText(formData.get("titleHint")),
    sourceType: normalizeSourceType(formData.get("sourceType")),
    ...imagePayload
  };
};

const parseJsonRequest = async (request: Request) => {
  const body = (await request.json()) as JsonImportPayload;

  return {
    text: normalizeText(body.text),
    titleHint: normalizeText(body.titleHint),
    sourceType: normalizeSourceType(body.sourceType),
    imageDataUrl: normalizeText(body.imageDataUrl) || null,
    imageMimeType: normalizeText(body.imageMimeType) || null
  };
};

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    const payload = contentType.includes("multipart/form-data")
      ? await parseMultipartRequest(request)
      : await parseJsonRequest(request);

    if (!payload.text && !payload.imageDataUrl) {
      return NextResponse.json({ error: "Envie um texto ou uma imagem para importar" }, { status: 400 });
    }

    const recipe = await runRecipeImportWorkflow(payload);
    return NextResponse.json(recipe);
  } catch (error) {
    if (error instanceof RecipeImportError) {
      const status = /openai_api_key/i.test(error.message)
        ? 503
        : /openai.*rejeitada|autenticação com a openai falhou/i.test(error.message)
        ? 401
        : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    console.error("import: erro inesperado", error);
    return NextResponse.json({ error: "Erro inesperado" }, { status: 500 });
  }
}
