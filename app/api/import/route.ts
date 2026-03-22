import { NextResponse } from "next/server";

import { RecipeImportError, parseRecipeText } from "@/lib/recipe-import";
import type { ParsedRecipe } from "@/lib/recipe-import";

type ImportPayload = {
  text?: string;
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    ingredients: {
      type: "array",
      items: { type: "string" }
    },
    preparo: { type: "string" },
    finalizacao: { type: "string" },
    favorite: { type: "boolean" }
  },
  required: ["name", "ingredients", "preparo", "finalizacao"],
  title: "Recipe"
};

const systemPrompt = `You are a recipe parser AI.
Your job is to transform messy recipes (text or OCR from images) into a clean and minimal structure for quick cooking recall.

STRICT RULES:
1. Remove EVERYTHING unnecessary: stories, tips, long explanations, personal comments.
2. Extract only: recipe name, ingredients, preparo, finalizacao, favorite.
3. Preparo must be summarized into ONE simple sentence.
4. Finalizacao must include baking time, resting, or finishing step.
5. Ingredients must be a clean list with one item per entry; ignore original bullets and rebuild them as plain strings.
6. Ignore any formatting from the source text. Normalize spacing, split ingredients in separate entries, and ensure preparo/finalizacao are trimmed sentences without extra line breaks.

OUTPUT FORMAT (MANDATORY JSON matching the provided schema):
{
  "name": "",
  "ingredients": [],
  "preparo": "",
  "finalizacao": "",
  "favorite": false
}`;

const coerceParsedRecipe = (raw: ParsedRecipe | null): ParsedRecipe => {
  if (!raw) {
    throw new RecipeImportError("Resposta vazia do agente");
  }
  return {
    name: raw.name?.trim() || "",
    ingredients: Array.isArray(raw.ingredients)
      ? raw.ingredients.map((item) => String(item).trim()).filter(Boolean)
      : [],
    preparo: raw.preparo?.trim() || "",
    finalizacao: raw.finalizacao?.trim() || "",
    favorite: Boolean(raw.favorite)
  };
};

type OpenAiContentBlock = { type?: string; text?: string };
type OpenAiOutput = {
  content?: OpenAiContentBlock[];
};

type OpenAiResponse = {
  output_text?: string[];
  output?: OpenAiOutput[];
};

const extractOutputText = (completion: OpenAiResponse): string | null => {
  const candidates: string[] = [];
  if (Array.isArray(completion.output_text)) {
    candidates.push(...completion.output_text);
  }
  if (Array.isArray(completion.output)) {
    for (const block of completion.output) {
      const textBlock = block.content?.find((item) => typeof item?.text === "string");
      if (textBlock?.text) {
        candidates.push(textBlock.text);
      }
    }
  }
  const serialized = candidates.map((item) => item.trim()).find(Boolean);
  return serialized ?? null;
};

const callOpenAi = async (text: string): Promise<ParsedRecipe | null> => {
  if (!OPENAI_API_KEY) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            "Converta o texto a seguir para JSON seguindo o schema (name, ingredients, preparo, finalizacao):\n\n" +
            text
        }
      ],
      text: {
        format: {
          type: "json_schema",
          schema: {
            name: "recipe_parser",
            schema,
            strict: true
          }
        }
      }
    })
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    throw new Error(`OpenAI respondeu ${response.status}: ${errorPayload}`);
  }

  const completion = (await response.json()) as OpenAiResponse & { output_parsed?: ParsedRecipe };

  if (completion.output_parsed) {
    return coerceParsedRecipe(completion.output_parsed);
  }

  const content = extractOutputText(completion);

  if (!content) {
    throw new RecipeImportError("Resposta vazia do modelo");
  }

  let parsed: ParsedRecipe | null = null;
  try {
    parsed = JSON.parse(content) as ParsedRecipe;
  } catch (error) {
    throw new RecipeImportError("Não foi possível interpretar o JSON retornado pelo modelo");
  }

  return coerceParsedRecipe(parsed);
};

export async function POST(request: Request) {
  let body: ImportPayload;
  try {
    body = (await request.json()) as ImportPayload;
  } catch (error) {
    console.error("import: JSON inválido", error);
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!body?.text || typeof body.text !== "string") {
    return NextResponse.json({ error: "Campo 'text' é obrigatório" }, { status: 400 });
  }

  if (OPENAI_API_KEY) {
    try {
      const aiRecipe = await callOpenAi(body.text);
      if (aiRecipe) {
        return NextResponse.json(aiRecipe);
      }
    } catch (error) {
      console.error("import: falha no agente OpenAI", error);
      // Continua para fallback local
    }
  }

  try {
    const parsed = parseRecipeText(body.text);
    return NextResponse.json(parsed);
  } catch (error) {
    if (error instanceof RecipeImportError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("import: erro inesperado", error, body.text?.slice(0, 120));
    return NextResponse.json({ error: "Erro inesperado" }, { status: 500 });
  }
}
