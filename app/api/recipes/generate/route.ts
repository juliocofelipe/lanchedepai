import { NextResponse } from "next/server";

import { RecipeImportError } from "@/server/importer/parser";
import { runRecipeGenerationWorkflow } from "@/server/recipes/agentic";

export const runtime = "nodejs";

type GenerateRecipePayload = {
  title?: string;
};

const mapRecipeImportErrorStatus = (message: string) => {
  if (/openai_api_key/i.test(message)) {
    return 503;
  }

  if (/openai.*rejeitada|autenticacao com a openai falhou|autenticação com a openai falhou/i.test(message)) {
    return 401;
  }

  return 400;
};

const mapUnexpectedErrorToResponse = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const responseBody =
    typeof (error as { responseBody?: unknown })?.responseBody === "string"
      ? ((error as { responseBody?: string }).responseBody ?? "")
      : "";

  if (/Incorrect API key provided/i.test(message) || /invalid_api_key/i.test(message) || /invalid_api_key/i.test(responseBody)) {
    return NextResponse.json(
      {
        error: "A OPENAI_API_KEY configurada foi rejeitada pela OpenAI. Gere uma nova chave em https://platform.openai.com/api-keys e atualize o .env/.env.local."
      },
      { status: 401 }
    );
  }

  if (/Cannot connect to API/i.test(message)) {
    return NextResponse.json({ error: "Nao foi possivel conectar a OpenAI no momento." }, { status: 502 });
  }

  return null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateRecipePayload;
    const title = typeof body.title === "string" ? body.title.trim() : "";

    if (!title) {
      return NextResponse.json({ error: "Informe o titulo da receita" }, { status: 400 });
    }

    const recipe = await runRecipeGenerationWorkflow(title);
    return NextResponse.json(recipe);
  } catch (error) {
    if (error instanceof RecipeImportError) {
      return NextResponse.json({ error: error.message }, { status: mapRecipeImportErrorStatus(error.message) });
    }

    const mappedResponse = mapUnexpectedErrorToResponse(error);
    if (mappedResponse) {
      return mappedResponse;
    }

    console.error("recipes/generate: erro inesperado", error);
    return NextResponse.json({ error: "Erro inesperado" }, { status: 500 });
  }
}
