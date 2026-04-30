"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";

import type { Recipe, RecipePayload, RecipeSourceType } from "@/types/recipe";

import GenerateRecipeModal from "./components/generate-recipe-modal";
import HeroSection from "./components/hero-section";
import ImportModal from "./components/import-modal";
import PrimaryActions from "./components/primary-actions";
import RecipeFormModal from "./components/recipe-form-modal";
import RecipeList from "./components/recipe-list";
import RecipePanel from "./components/recipe-panel";
import SearchBar from "./components/search-bar";
import TopActions from "./components/top-actions";
import VoiceFeedback from "./components/voice-feedback";
import styles from "./recipes.module.css";
import { emptyFormState, toFormState, type RecipeFormState } from "./types";

type VoiceRecognitionResultEvent = {
  results: ArrayLike<{
    0: {
      transcript: string;
    };
  }>;
};

type VoiceRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: VoiceRecognitionResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type VoiceRecognitionConstructor = new () => VoiceRecognition;

const normalizeLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const recipePayloadFromForm = (state: RecipeFormState): RecipePayload => ({
  name: state.name.trim(),
  ingredients: normalizeLines(state.ingredientsText),
  preparo: state.preparo.trim(),
  finalizacao: state.finalizacao.trim(),
  favorite: state.favorite,
  sourceType: state.sourceType,
  sourceText: state.sourceText ?? null,
  sourceTitle: state.sourceTitle ?? null,
  aiProvider: state.aiProvider ?? null,
  aiModel: state.aiModel ?? null,
  processingConfidence: state.processingConfidence ?? null,
  reviewRequired: Boolean(state.reviewRequired),
  processingMetadata: state.processingMetadata ?? null
});

const recipeDraftToFormState = (recipe: RecipePayload): RecipeFormState => ({
  id: undefined,
  name: recipe.name,
  ingredientsText: recipe.ingredients.join("\n"),
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
});

const jsonRequest = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const isFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(url, {
    ...init,
    headers: isFormDataBody
      ? init?.headers
      : {
          "Content-Type": "application/json",
          ...(init?.headers || {})
        }
  });

  if (!response.ok) {
    let message = "Erro ao comunicar com o servidor";
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // Mantem a mensagem padrao.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
};

const upsertRecipe = (items: Recipe[], updated: Recipe): Recipe[] => {
  const exists = items.some((item) => item.id === updated.id);
  return exists ? items.map((item) => (item.id === updated.id ? updated : item)) : [...items, updated];
};

export default function RecipesScreen() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formState, setFormState] = useState<RecipeFormState>(emptyFormState);
  const [importOpen, setImportOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateTitle, setGenerateTitle] = useState("");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechActive, setSpeechActive] = useState(false);
  const [speechTarget, setSpeechTarget] = useState<"query" | "import">("query");
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [importImageFile, setImportImageFile] = useState<File | null>(null);
  const [importImagePreview, setImportImagePreview] = useState<string | null>(null);
  const [importSourceType, setImportSourceType] = useState<RecipeSourceType>("text_import");
  const [importTransforming, setImportTransforming] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const speechRecognitionRef = useRef<VoiceRecognition | null>(null);
  const speechTargetRef = useRef<"query" | "import">("query");

  useEffect(() => {
    speechTargetRef.current = speechTarget;
  }, [speechTarget]);

  const stopCameraStream = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
    }
    cameraStreamRef.current = null;
  }, []);

  const handleImageFileSelection = useCallback(
    (file: File | null, sourceType: RecipeSourceType = "image_upload") => {
      setImportImageFile(file);
      setCameraError(null);
      setCameraOpen(false);

      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = null;
      }

      stopCameraStream();

      if (!file) {
        setImportSourceType(importText.trim() ? "text_import" : "text_import");
        setImportInfo(null);
        return;
      }

      setImportSourceType(sourceType);
      setImportError(null);
      setImportInfo(`Imagem pronta para análise (${file.name || "captura"}). Clique em Transformar.`);
    },
    [importText, stopCameraStream]
  );

  const handleClearImportImage = useCallback(() => {
    setImportImageFile(null);
    setImportInfo(null);
    setImportSourceType("text_import");
  }, []);

  const closeCameraCapture = useCallback(() => {
    setCameraOpen(false);
    if (cameraVideoRef.current) {
      try {
        cameraVideoRef.current.srcObject = null;
      } catch {
        // ignore
      }
    }
    stopCameraStream();
  }, [stopCameraStream]);

  const openCameraCapture = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("Seu dispositivo nao suporta captura direta.");
      return;
    }

    setCameraError(null);
    setCameraLoading(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      cameraStreamRef.current = stream;
      setCameraOpen(true);
    } catch (cameraProblem) {
      console.error("camera open", cameraProblem);
      setCameraError("Nao foi possivel acessar a camera. Verifique as permissoes.");
      stopCameraStream();
    } finally {
      setCameraLoading(false);
    }
  }, [stopCameraStream]);

  const handleCameraCapture = useCallback(() => {
    const video = cameraVideoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError("A camera ainda esta inicializando. Tente novamente.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");

    if (!context) {
      setCameraError("Nao foi possivel preparar a captura.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError("Nao foi possivel gerar a imagem.");
          return;
        }

        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
        handleImageFileSelection(file, "camera_capture");
        closeCameraCapture();
      },
      "image/jpeg",
      0.92
    );
  }, [closeCameraCapture, handleImageFileSelection]);

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? []);
    if (file) {
      handleImageFileSelection(file, "image_upload");
    }
    event.target.value = "";
  };

  const handleImportDragOver = useCallback((event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleImportDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      const [file] = Array.from(event.dataTransfer.files ?? []);
      if (file) {
        handleImageFileSelection(file, "image_upload");
      }
    },
    [handleImageFileSelection]
  );

  const handleImportPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      const imageItem = Array.from(items).find((item) => item.type.startsWith("image/"));
      if (imageItem) {
        event.preventDefault();
        const file = imageItem.getAsFile();
        if (file) {
          handleImageFileSelection(file, "image_upload");
        }
      }
    },
    [handleImageFileSelection]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const speechRecognitionApi =
      ((window as typeof window & { SpeechRecognition?: VoiceRecognitionConstructor }).SpeechRecognition as
        | VoiceRecognitionConstructor
        | undefined) ??
      ((window as typeof window & { webkitSpeechRecognition?: VoiceRecognitionConstructor }).webkitSpeechRecognition as
        | VoiceRecognitionConstructor
        | undefined);

    if (!speechRecognitionApi) {
      setSpeechSupported(false);
      return;
    }

    setSpeechSupported(true);
    const recognition = new speechRecognitionApi();
    recognition.lang = "pt-BR";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim().replace(/[.。]+$/, "");
      if (transcript) {
        if (speechTargetRef.current === "query") {
          setQuery(transcript);
        } else {
          setImportText((prev) => (prev ? `${prev}\n${transcript}` : transcript));
          setImportInfo("Texto adicionado via voz");
          if (!importImageFile) {
            setImportSourceType("text_import");
          }
        }
      }
      setSpeechActive(false);
    };
    recognition.onerror = (event) => {
      setSpeechError("Nao foi possivel capturar sua voz.");
      console.error("speech error", event);
    };
    recognition.onend = () => {
      setSpeechActive(false);
    };
    speechRecognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
      speechRecognitionRef.current = null;
    };
  }, [importImageFile]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } catch (logoutError) {
      console.error("logout", logoutError);
    } finally {
      router.push("/login");
    }
  }, [router]);

  const loadRecipes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await jsonRequest<Recipe[]>("/api/recipes");
      setRecipes(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar receitas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecipes();
  }, [loadRecipes]);

  useEffect(() => {
    if (!importImageFile) {
      setImportImagePreview(null);
      return undefined;
    }
    const previewUrl = URL.createObjectURL(importImageFile);
    setImportImagePreview(previewUrl);
    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [importImageFile]);

  useEffect(() => {
    if (!cameraOpen) return;
    const video = cameraVideoRef.current;
    if (!video || !cameraStreamRef.current) return;
    video.srcObject = cameraStreamRef.current;
    const playPromise = video.play?.();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
    return () => {
      try {
        video.pause();
      } catch {
        // ignore
      }
      video.srcObject = null;
    };
  }, [cameraOpen]);

  useEffect(
    () => () => {
      stopCameraStream();
    },
    [stopCameraStream]
  );

  const orderedRecipes = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...recipes]
      .filter((recipe) => recipe.name.toLowerCase().includes(term))
      .sort((a, b) => {
        if (Boolean(b.favorite) !== Boolean(a.favorite)) {
          return Number(b.favorite) - Number(a.favorite);
        }
        return b.updatedAt - a.updatedAt;
      });
  }, [recipes, query]);

  const selectedRecipe = selectedId ? recipes.find((recipe) => recipe.id === selectedId) ?? null : null;

  const handleSelectRecipe = (recipe: Recipe) => {
    setSelectedId(recipe.id);
    void (async () => {
      try {
        const updated = await jsonRequest<Recipe>(`/api/recipes/${recipe.id}`, {
          method: "PATCH",
          body: JSON.stringify({ touch: true })
        });
        setRecipes((prev) => upsertRecipe(prev, updated));
      } catch (err) {
        console.error("Erro ao atualizar ordem", err);
      }
    })();
  };

  const openCreate = () => {
    setFormState(emptyFormState());
    setFormOpen(true);
  };

  const openEdit = (recipe: Recipe) => {
    setFormState(toFormState(recipe));
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setFormState(emptyFormState());
  };

  const closeImport = () => {
    setImportOpen(false);
    setImportText("");
    setImportError(null);
    setImportInfo(null);
    setImportImageFile(null);
    setImportSourceType("text_import");
    setCameraError(null);
    setCameraLoading(false);
    closeCameraCapture();
  };

  const openImport = () => {
    setImportText("");
    setImportError(null);
    setImportInfo(null);
    setImportImageFile(null);
    setImportSourceType("text_import");
    setCameraError(null);
    setCameraLoading(false);
    closeCameraCapture();
    setImportOpen(true);
  };

  const closeGenerate = () => {
    setGenerateOpen(false);
    setGenerateTitle("");
    setGenerateError(null);
    setGenerateLoading(false);
  };

  const openGenerate = () => {
    setGenerateTitle("");
    setGenerateError(null);
    setGenerateLoading(false);
    setGenerateOpen(true);
  };

  const handleFavoriteToggle = async (recipe: Recipe) => {
    try {
      const currentIngredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
      const updated = await jsonRequest<Recipe>(`/api/recipes/${recipe.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: recipe.name,
          ingredients: currentIngredients,
          preparo: recipe.preparo,
          finalizacao: recipe.finalizacao,
          favorite: !recipe.favorite,
          sourceType: recipe.sourceType,
          sourceText: recipe.sourceText,
          sourceTitle: recipe.sourceTitle,
          aiProvider: recipe.aiProvider,
          aiModel: recipe.aiModel,
          processingConfidence: recipe.processingConfidence,
          reviewRequired: recipe.reviewRequired,
          processingMetadata: recipe.processingMetadata
        })
      });
      setRecipes((prev) => upsertRecipe(prev, updated));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nao foi possivel atualizar");
    }
  };

  const handleDeleteRecipe = async (recipe: Recipe) => {
    const confirmDelete = typeof window === "undefined" ? true : window.confirm(`Remover "${recipe.name}" da lista?`);
    if (!confirmDelete) return;

    try {
      await jsonRequest(`/api/recipes/${recipe.id}`, { method: "DELETE" });
      setRecipes((prev) => prev.filter((item) => item.id !== recipe.id));
      setSelectedId((prev) => (prev === recipe.id ? null : prev));
      if (formOpen && formState.id === recipe.id) {
        closeForm();
      } else if (formState.id === recipe.id) {
        setFormState(emptyFormState());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nao foi possivel excluir");
    }
  };

  const handleSaveRecipe = async () => {
    const trimmedName = formState.name.trim();
    if (!trimmedName) return;

    setSaving(true);
    setError(null);
    const payload = recipePayloadFromForm(formState);
    const isEditing = Boolean(formState.id);

    try {
      const recipe = await jsonRequest<Recipe>(isEditing ? `/api/recipes/${formState.id}` : "/api/recipes", {
        method: isEditing ? "PATCH" : "POST",
        body: JSON.stringify(payload)
      });
      setRecipes((prev) => upsertRecipe(prev, recipe));
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nao foi possivel salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleImportApply = async () => {
    const trimmed = importText.trim();
    if (!trimmed && !importImageFile) {
      setImportError("Cole um texto ou selecione uma imagem antes de transformar");
      return;
    }

    setImportTransforming(true);
    setImportError(null);

    try {
      const parsed = importImageFile
        ? await (async () => {
            const body = new FormData();
            body.set("image", importImageFile);
            body.set("sourceType", importSourceType);
            if (trimmed) {
              body.set("text", trimmed);
            }
            return await jsonRequest<RecipePayload>("/api/import", {
              method: "POST",
              body
            });
          })()
        : await jsonRequest<RecipePayload>("/api/import", {
            method: "POST",
            body: JSON.stringify({
              text: trimmed,
              sourceType: "text_import"
            })
          });

      setFormState(recipeDraftToFormState(parsed));
      closeImport();
      setFormOpen(true);
    } catch (importProblem) {
      setImportError(importProblem instanceof Error ? importProblem.message : "Erro ao importar");
    } finally {
      setImportTransforming(false);
    }
  };

  const handleGenerateApply = async () => {
    const trimmedTitle = generateTitle.trim();
    if (!trimmedTitle) {
      setGenerateError("Informe o titulo da receita");
      return;
    }

    setGenerateLoading(true);
    setGenerateError(null);

    try {
      const generated = await jsonRequest<RecipePayload>("/api/recipes/generate", {
        method: "POST",
        body: JSON.stringify({ title: trimmedTitle })
      });

      setFormState(recipeDraftToFormState(generated));
      closeGenerate();
      setFormOpen(true);
    } catch (generationProblem) {
      setGenerateError(generationProblem instanceof Error ? generationProblem.message : "Erro ao gerar receita");
    } finally {
      setGenerateLoading(false);
    }
  };

  const handleStartListening = (target: "query" | "import" = "query") => {
    if (!speechSupported || !speechRecognitionRef.current) {
      setSpeechError("Seu navegador nao suporta ditado ainda.");
      return;
    }
    setSpeechTarget(target);
    setSpeechError(null);
    try {
      speechRecognitionRef.current.start();
      setSpeechActive(true);
    } catch (speechProblem) {
      console.error("speech start", speechProblem);
      setSpeechError("Nao foi possivel iniciar o microfone.");
    }
  };

  const handleStopListening = () => {
    if (!speechRecognitionRef.current) return;
    try {
      speechRecognitionRef.current.stop();
    } catch (speechProblem) {
      console.error("speech stop", speechProblem);
    }
  };

  return (
    <main className={styles.container}>
      <TopActions onLogout={handleLogout} />
      <h1 className="sr-only">Cozya</h1>
      <HeroSection />

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <SearchBar
        query={query}
        onQueryChange={setQuery}
        speechActive={speechActive && speechTarget === "query"}
        onSpeechStart={() => handleStartListening("query")}
        onSpeechStop={handleStopListening}
      />

      {!speechSupported && (
        <p className={styles.importHint} style={{ marginTop: 4 }}>
          Seu navegador nao suporta ditado. Experimente o Chrome para Android ou desktop.
        </p>
      )}

      <PrimaryActions onImport={openImport} onGenerate={openGenerate} onCreate={openCreate} />

      <p className={styles.sectionLabel}>Receitas salvas</p>

      <RecipeList
        recipes={orderedRecipes}
        loading={loading}
        emptyMessage="Nenhuma receita combina com a busca."
        onSelect={handleSelectRecipe}
        onToggleFavorite={(recipe) => void handleFavoriteToggle(recipe)}
        onEdit={openEdit}
        onDelete={(recipe) => void handleDeleteRecipe(recipe)}
      />

      {selectedRecipe && <RecipePanel recipe={selectedRecipe} onClose={() => setSelectedId(null)} />}

      <RecipeFormModal
        open={formOpen}
        formState={formState}
        setFormState={setFormState}
        saving={saving}
        onClose={closeForm}
        onSave={() => void handleSaveRecipe()}
      />

      <ImportModal
        open={importOpen}
        importText={importText}
        importError={importError}
        importInfo={importInfo}
        importTransforming={importTransforming}
        importImagePreview={importImagePreview}
        importImageFileName={importImageFile?.name ?? null}
        cameraOpen={cameraOpen}
        cameraError={cameraError}
        cameraLoading={cameraLoading}
        onClose={closeImport}
        onTextChange={(value) => {
          setImportText(value);
          setImportError(null);
          if (!importImageFile) {
            setImportSourceType("text_import");
          }
        }}
        onApply={() => void handleImportApply()}
        onFileChange={handleFileInputChange}
        onImportDragOver={handleImportDragOver}
        onImportDrop={handleImportDrop}
        onImportPaste={handleImportPaste}
        onClearImage={handleClearImportImage}
        onOpenCamera={() => void openCameraCapture()}
        onCloseCamera={closeCameraCapture}
        onCaptureFromCamera={() => void handleCameraCapture()}
        importFileInputRef={importFileInputRef}
        cameraVideoRef={cameraVideoRef}
        speechActive={speechActive && speechTarget === "import"}
        onSpeechStart={() => handleStartListening("import")}
        onSpeechStop={handleStopListening}
      />

      <GenerateRecipeModal
        open={generateOpen}
        title={generateTitle}
        loading={generateLoading}
        error={generateError}
        onClose={closeGenerate}
        onTitleChange={(value) => {
          setGenerateTitle(value);
          setGenerateError(null);
        }}
        onApply={() => void handleGenerateApply()}
      />

      <VoiceFeedback error={speechError} />
    </main>
  );
}
