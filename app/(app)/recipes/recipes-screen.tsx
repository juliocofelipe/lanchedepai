"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent
} from "react";

import type { ParsedRecipe } from "@/server/importer/parser";
import type { Recipe, RecipePayload } from "@/types/recipe";

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
  favorite: state.favorite
});

const jsonRequest = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
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
      // Mantém mensagem padrão
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
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechActive, setSpeechActive] = useState(false);
  const [speechTarget, setSpeechTarget] = useState<"query" | "import">("query");
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [importImageFile, setImportImageFile] = useState<File | null>(null);
  const [importImagePreview, setImportImagePreview] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrError, setOcrError] = useState<string | null>(null);
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
  const latestOcrFileRef = useRef<File | null>(null);
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

  const processImageWithOcr = useCallback(async (file: File) => {
    setOcrLoading(true);
    setOcrProgress(0);
    setOcrError(null);
    setImportError(null);
    setImportInfo(null);
    try {
      const { default: Tesseract } = await import("tesseract.js");
      const result = await Tesseract.recognize(file, "por+eng", {
        logger: (message: { status?: string; progress?: number }) => {
          if (message.status === "recognizing text" && typeof message.progress === "number") {
            setOcrProgress(message.progress);
          }
        }
      });
      if (latestOcrFileRef.current !== file) {
        return;
      }
      const text = result?.data?.text?.trim();
      if (!text) {
        setOcrError("Não encontramos texto na imagem selecionada");
        return;
      }
      setOcrError(null);
      setImportText(text);
      setImportInfo(`Texto extraído automaticamente (${file.name})`);
    } catch (ocrProblem) {
      if (latestOcrFileRef.current === file) {
        setOcrError("Erro ao extrair texto da imagem");
      }
      console.error("OCR", ocrProblem);
    } finally {
      if (latestOcrFileRef.current === file) {
        setOcrLoading(false);
      }
    }
  }, []);

  const handleImageFileSelection = useCallback(
    (file: File | null) => {
      latestOcrFileRef.current = file;
      setImportImageFile(file);
      setCameraError(null);
      setCameraOpen(false);
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = null;
      }
      stopCameraStream();
      if (!file) {
        setOcrError(null);
        setImportInfo(null);
        setOcrLoading(false);
        setOcrProgress(0);
        return;
      }
      setImportText("");
      setImportError(null);
      setImportInfo(null);
      void processImageWithOcr(file);
    },
    [processImageWithOcr, stopCameraStream]
  );

  const handleClearImportImage = useCallback(() => {
    handleImageFileSelection(null);
  }, [handleImageFileSelection]);

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
      setCameraError("Seu dispositivo não suporta captura direta.");
      return;
    }
    setCameraError(null);
    setCameraLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      cameraStreamRef.current = stream;
      setCameraOpen(true);
    } catch (cameraProblem) {
      console.error("camera open", cameraProblem);
      setCameraError("Não foi possível acessar a câmera. Verifique as permissões.");
      stopCameraStream();
    } finally {
      setCameraLoading(false);
    }
  }, [stopCameraStream]);

  const handleCameraCapture = useCallback(() => {
    const video = cameraVideoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError("A câmera ainda está inicializando. Tente novamente.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("Não foi possível preparar a captura.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setCameraError("Não foi possível gerar a imagem.");
        return;
      }
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
      handleImageFileSelection(file);
      closeCameraCapture();
    }, "image/jpeg", 0.92);
  }, [closeCameraCapture, handleImageFileSelection]);

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? []);
    if (file) {
      handleImageFileSelection(file);
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
        handleImageFileSelection(file);
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
          handleImageFileSelection(file);
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
        }
      }
      setSpeechActive(false);
    };
    recognition.onerror = (event) => {
      setSpeechError("Não foi possível capturar sua voz.");
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
  }, []);

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
    setOcrError(null);
    setOcrLoading(false);
    setOcrProgress(0);
    latestOcrFileRef.current = null;
    setCameraError(null);
    setCameraLoading(false);
    closeCameraCapture();
  };

  const openImport = () => {
    setImportText("");
    setImportError(null);
    setImportInfo(null);
    setImportImageFile(null);
    setOcrError(null);
    setOcrLoading(false);
    setOcrProgress(0);
    latestOcrFileRef.current = null;
    setCameraError(null);
    setCameraLoading(false);
    closeCameraCapture();
    setImportOpen(true);
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
          favorite: !recipe.favorite
        })
      });
      setRecipes((prev) => upsertRecipe(prev, updated));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar");
    }
  };

  const handleDeleteRecipe = async (recipe: Recipe) => {
    const confirmDelete =
      typeof window === "undefined" ? true : window.confirm(`Remover "${recipe.name}" da lista?`);
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
      setError(err instanceof Error ? err.message : "Não foi possível excluir");
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
      setError(err instanceof Error ? err.message : "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleImportApply = async () => {
    const trimmed = importText.trim();
    if (!trimmed) {
      setImportError("Cole ou extraia o texto da receita antes de transformar");
      return;
    }

    setImportTransforming(true);
    setImportError(null);
    try {
      const parsed = await jsonRequest<ParsedRecipe>("/api/import", {
        method: "POST",
        body: JSON.stringify({ text: trimmed })
      });
      setFormState({
        id: undefined,
        name: parsed.name,
        ingredientsText: parsed.ingredients.join("\n"),
        preparo: parsed.preparo,
        finalizacao: parsed.finalizacao,
        favorite: Boolean(parsed.favorite)
      });
      closeImport();
      setFormOpen(true);
    } catch (importProblem) {
      setImportError(importProblem instanceof Error ? importProblem.message : "Erro ao importar");
    } finally {
      setImportTransforming(false);
    }
  };

  const handleStartListening = (target: "query" | "import" = "query") => {
    if (!speechSupported || !speechRecognitionRef.current) {
      setSpeechError("Seu navegador não suporta ditado ainda.");
      return;
    }
    setSpeechTarget(target);
    setSpeechError(null);
    try {
      speechRecognitionRef.current.start();
      setSpeechActive(true);
    } catch (speechProblem) {
      console.error("speech start", speechProblem);
      setSpeechError("Não foi possível iniciar o microfone.");
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
          Seu navegador não suporta ditado — experimente o Chrome para Android ou desktop.
        </p>
      )}

      <PrimaryActions onImport={openImport} onCreate={openCreate} />

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
        ocrLoading={ocrLoading}
        ocrProgress={ocrProgress}
        ocrError={ocrError}
        cameraOpen={cameraOpen}
        cameraError={cameraError}
        cameraLoading={cameraLoading}
        onClose={closeImport}
        onTextChange={(value) => {
          setImportText(value);
          setImportError(null);
          setImportInfo(null);
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

      <VoiceFeedback error={speechError} />
    </main>
  );
}
