import type { RecipePayload } from "@/types/recipe";

export type ParsedRecipe = RecipePayload & { ingredients: string[] };

export class RecipeImportError extends Error {}

const ensureStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).map((item) => item.trim()).filter(Boolean);
};

const normalizeLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

type ImportedRecipeJson = {
  name?: string;
  title?: string;
  ingredients?: string[] | string;
  preparo?: string;
  preparation?: string;
  instructions?: string;
  finalizacao?: string;
  finalization?: string;
  finish?: string;
  favorite?: boolean;
};

const parseJsonRecipe = (raw: string): ParsedRecipe | null => {
  let data: ImportedRecipeJson | null = null;
  try {
    data = JSON.parse(raw) as ImportedRecipeJson;
  } catch {
    return null;
  }

  if (!data || typeof data !== "object") return null;

  const name = (data.name || data.title || "").trim();
  if (!name) return null;

  const ingredientsArray = Array.isArray(data.ingredients)
    ? ensureStringArray(data.ingredients)
    : typeof data.ingredients === "string"
    ? normalizeLines(data.ingredients.replace(/[,;]/g, "\n"))
    : [];

  return {
    name,
    ingredients: ingredientsArray,
    preparo: (data.preparo || data.preparation || data.instructions || "").trim(),
    finalizacao: (data.finalizacao || data.finalization || data.finish || "").trim(),
    favorite: Boolean(data.favorite)
  };
};

const stripDiacritics = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

type Section = "ingredients" | "preparo" | "finalizacao" | "guess";

const sectionFromLabel = (label: string, strict = false): Section | null => {
  const normalized = stripDiacritics(label)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  const match = (keys: string[]) =>
    keys.some((key) => (strict ? normalized.startsWith(key) : normalized.includes(key)));

  if (match(["ingrediente", "ingredientes", "ingred", "ing"])) {
    return "ingredients";
  }
  if (match(["preparo", "modo", "preparar", "passo", "modo de preparo"])) {
    return "preparo";
  }
  if (match(["final", "finalizacao", "finalizar", "servir", "acabamento"])) {
    return "finalizacao";
  }
  return null;
};

const looksLikeFinalInstruction = (value: string): boolean => {
  if (!value) return false;
  if (/\b\d+\s?(?:min|mins|minuto|minutos|h|hora|horas)\b/i.test(value)) {
    return true;
  }
  if (/\d+\s?(?:°|graus|c|f)\b/i.test(value)) {
    return true;
  }
  const normalized = stripDiacritics(value);
  const keywords = [
    "sirva",
    "sirvam",
    "servir",
    "finalize",
    "finalizar",
    "finalizacao",
    "acabamento",
    "decore",
    "decore com",
    "temperatura",
    "asse",
    "assar",
    "forno",
    "descanso",
    "descanse",
    "descansar",
    "esfrie",
    "esfriar",
    "sirva quente",
    "sirva frio"
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
};

const splitPreparoFinalizacao = (preparoText: string, finalizacaoText: string) => {
  let finalizacao = finalizacaoText.trim();
  let preparo = preparoText.trim();

  if (!preparo) {
    return { preparo: "", finalizacao };
  }

  if (finalizacao) {
    return { preparo, finalizacao };
  }

  const lineSegments = preparo
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lineSegments.length > 1) {
    const candidate = lineSegments[lineSegments.length - 1];
    if (candidate && (looksLikeFinalInstruction(candidate) || candidate.length <= 200)) {
      lineSegments.pop();
      finalizacao = candidate;
      preparo = lineSegments.join(" ").trim();
      return { preparo, finalizacao };
    }
  }

  const sentences = preparo
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length > 1) {
    const candidate = sentences[sentences.length - 1];
    if (looksLikeFinalInstruction(candidate) || candidate.length <= 180) {
      sentences.pop();
      finalizacao = candidate;
      preparo = sentences.join(" ").trim();
      return { preparo, finalizacao };
    }
  }

  return { preparo, finalizacao };
};

export const parseRecipeText = (raw: string): ParsedRecipe => {
  if (!raw.trim()) {
    throw new RecipeImportError("Cole o texto da receita para importar");
  }

  const jsonParsed = parseJsonRecipe(raw);
  if (jsonParsed) {
    return jsonParsed;
  }

  const lines = raw.split(/\r?\n/);
  let name = "";
  const ingredients: string[] = [];
  let preparo = "";
  let finalizacao = "";
  let section: Section = "guess";

  const pushIngredientsFromText = (value: string) => {
    const cleaned = value.replace(/^[-•\u2022]\s?/, "").trim();
    if (!cleaned) return;
    const fragments = cleaned
      .split(/[;,]/)
      .map((fragment) => fragment.trim())
      .filter(Boolean);
    if (fragments.length) {
      ingredients.push(...fragments);
    } else {
      ingredients.push(cleaned);
    }
  };

  const appendText = (current: string, addition: string) =>
    [current, addition].filter(Boolean).join(current ? " " : "");

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const normalized = stripDiacritics(trimmed);

    if (normalized.startsWith("nome:")) {
      name = trimmed.slice(trimmed.indexOf(":") + 1).trim() || name;
      return;
    }

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex !== -1) {
      const label = trimmed.slice(0, colonIndex);
      const remainder = trimmed.slice(colonIndex + 1).trim();
      const possibleSection = sectionFromLabel(label || "");
      if (possibleSection) {
        section = possibleSection;
        if (remainder) {
          if (section === "ingredients") {
            pushIngredientsFromText(remainder);
          } else if (section === "preparo") {
            preparo = appendText(preparo, remainder);
          } else if (section === "finalizacao") {
            finalizacao = appendText(finalizacao, remainder);
          }
        }
        return;
      }
    }

    const headerSection = sectionFromLabel(trimmed, true);
    if (headerSection) {
      section = headerSection;
      return;
    }

    if (!name) {
      name = trimmed;
      return;
    }

    if (section === "ingredients" || /^[-•\u2022]/.test(trimmed)) {
      pushIngredientsFromText(trimmed);
      return;
    }

    if (section === "preparo") {
      preparo = appendText(preparo, trimmed);
      return;
    }

    if (section === "finalizacao") {
      finalizacao = appendText(finalizacao, trimmed);
      return;
    }

    if (!ingredients.length) {
      pushIngredientsFromText(trimmed);
      return;
    }

    if (!preparo) {
      preparo = trimmed;
      return;
    }

    if (!finalizacao) {
      finalizacao = trimmed;
      return;
    }

    preparo = appendText(preparo, trimmed);
  });

  if (!name.trim()) {
    throw new RecipeImportError("Não foi possível identificar o nome da receita");
  }

  if (!ingredients.length && preparo) {
    ingredients.push("Descreva os ingredientes em linhas separadas");
  }

  const { preparo: normalizedPreparo, finalizacao: normalizedFinalizacao } = splitPreparoFinalizacao(
    preparo,
    finalizacao
  );

  return {
    name: name.trim(),
    ingredients: ingredients.map((item) => item.trim()).filter(Boolean),
    preparo: normalizedPreparo.trim(),
    finalizacao: normalizedFinalizacao.trim(),
    favorite: false
  };
};
