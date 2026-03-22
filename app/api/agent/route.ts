import { NextResponse } from "next/server";

import {
  RecipeValidationError,
  createRecipeRecord,
  normalizeIncomingPayload
} from "@/lib/recipes";

type AgentRecipePayload = {
  id?: string;
  name?: string;
  ingredients?: unknown;
  preparo?: string;
  finalizacao?: string;
  favorite?: boolean;
};

type AgentRequestBody = {
  data?: AgentRecipePayload;
  metadata?: Record<string, unknown>;
};

const sharedSecret = process.env.AGENT_SHARED_SECRET;

const secretError = NextResponse.json({ error: "Integração não configurada" }, { status: 500 });

const unauthorized = NextResponse.json({ error: "Não autorizado" }, { status: 401 });

const badRequest = (message: string) => NextResponse.json({ error: message }, { status: 400 });

const extractSecret = (request: Request) => {
  const headerSecret = request.headers.get("x-agent-secret");
  if (headerSecret) return headerSecret;

  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    return bearer.slice("Bearer ".length).trim();
  }

  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  return secret ?? null;
};

export async function POST(request: Request) {
  if (!sharedSecret) {
    console.error("AGENT_SHARED_SECRET não está configurada");
    return secretError;
  }

  const providedSecret = extractSecret(request);
  if (providedSecret !== sharedSecret) {
    return unauthorized;
  }

  let body: AgentRequestBody;
  try {
    body = (await request.json()) as AgentRequestBody;
  } catch (error) {
    console.error("agent: JSON inválido", error);
    return badRequest("JSON inválido");
  }

  if (!body?.data) {
    return badRequest("Campo 'data' é obrigatório");
  }

  try {
    const payload = normalizeIncomingPayload({
      name: body.data.name,
      ingredients: body.data.ingredients,
      preparo: body.data.preparo,
      finalizacao: body.data.finalizacao,
      favorite: body.data.favorite
    });

    const recipe = await createRecipeRecord({ ...payload, id: body.data.id });

    return NextResponse.json(recipe, { status: 201 });
  } catch (error) {
    if (error instanceof RecipeValidationError) {
      return badRequest(error.message);
    }
    console.error("agent: erro inesperado", error, body);
    return NextResponse.json({ error: "Erro inesperado" }, { status: 500 });
  }
}
