"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ImageDown, LogOut, Mic, Pencil, Star, Trash2, UploadCloud, Wand2, X } from "lucide-react";

import type { ParsedRecipe } from "@/lib/recipe-import";
import type { Recipe, RecipePayload } from "@/types/recipe";
import styles from "./page.module.css";

import type { ChangeEvent, ClipboardEvent, DragEvent } from "react";

type RecipeFormState = {
  id?: string;
  name: string;
  ingredientsText: string;
  preparo: string;
  finalizacao: string;
  favorite: boolean;
};

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

const emptyFormState = (): RecipeFormState => ({
  name: "",
  ingredientsText: "",
  preparo: "",
  finalizacao: "",
  favorite: false
});

const toFormState = (recipe?: Recipe): RecipeFormState =>
  recipe
    ? {
        id: recipe.id,
        name: recipe.name,
        ingredientsText: (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).join("\n"),
        preparo: recipe.preparo,
        finalizacao: recipe.finalizacao,
        favorite: Boolean(recipe.favorite)
      }
    : emptyFormState();

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
  return exists
    ? items.map((item) => (item.id === updated.id ? updated : item))
    : [...items, updated];
};


export default function Home() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formState, setFormState] = useState<RecipeFormState>(emptyFormState);
  const [importOpen, setImportOpen] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechActive, setSpeechActive] = useState(false);
  const [speechTranscript, setSpeechTranscript] = useState("");
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
        setSpeechTranscript(transcript);
        setQuery(transcript);
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
    } catch (error) {
      console.error("logout", error);
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

  useEffect(() => () => {
    stopCameraStream();
  }, [stopCameraStream]);


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

  const selectedRecipe = selectedId
    ? recipes.find((recipe) => recipe.id === selectedId) ?? null
    : null;

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
      typeof window === "undefined"
        ? true
        : window.confirm(`Remover "${recipe.name}" da lista?`);
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
      const recipe = await jsonRequest<Recipe>(
        isEditing ? `/api/recipes/${formState.id}` : "/api/recipes",
        {
          method: isEditing ? "PATCH" : "POST",
          body: JSON.stringify(payload)
        }
      );
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

  const handleStartListening = () => {
    if (!speechSupported || !speechRecognitionRef.current) {
      setSpeechError("Seu navegador não suporta ditado ainda.");
      return;
    }
    setSpeechError(null);
    setSpeechTranscript("");
    try {
      speechRecognitionRef.current.start();
      setSpeechActive(true);
    } catch (error) {
      console.error("speech start", error);
      setSpeechError("Não foi possível iniciar o microfone.");
    }
  };

  const handleStopListening = () => {
    if (!speechRecognitionRef.current) return;
    try {
      speechRecognitionRef.current.stop();
    } catch (error) {
      console.error("speech stop", error);
    }
  };

  return (
    <main className={styles.container}>
      <div className={styles.topActions}>
        <button className={styles.logoutIconButton} onClick={() => void handleLogout()} aria-label="Sair">
          <LogOut size={18} aria-hidden="true" />
        </button>
      </div>
      <h1 className="sr-only">Cozya</h1>
      <section className={styles.hero}>
        <div className={styles.brand}>
          <div className={styles.logoWrapper}>
            <Image src="/images/cozya-logo.png" fill sizes="220px" alt="Logo do Cozya" priority />
          </div>
          <p className={styles.tagline}>Receitas rápidas sempre visíveis.</p>
        </div>
      </section>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.searchCard}>
        <input
          aria-label="Buscar receitas"
          className={styles.searchInput}
          placeholder="O que vamos fazer?"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
        <button
          type="button"
          className={styles.searchIconButton}
          aria-label={speechActive ? "Parar ditado" : "Buscar com voz"}
          onClick={() => (speechActive ? handleStopListening() : handleStartListening())}
        >
          <Mic size={16} aria-hidden="true" />
        </button>
      </div>

      {!speechSupported && (
        <p className={styles.importHint} style={{ marginTop: 4 }}>
          Seu navegador não suporta ditado — experimente o Chrome para Android ou desktop.
        </p>
      )}

      <div className={styles.actions}>
        <button className={styles.ghostButton} onClick={openImport}>
          <UploadCloud size={18} aria-hidden="true" />
          <span>Importar receita</span>
        </button>
        <button className={styles.accentButton} onClick={openCreate}>
          <span>+ Nova Receita</span>
        </button>
      </div>

      <p className={styles.sectionLabel}>Receitas salvas</p>
      <section className={styles.list}>
        {loading && <p className={styles.emptyState}>Carregando receitas...</p>}
        {!loading && orderedRecipes.length === 0 && (
          <p className={styles.emptyState}>Nenhuma receita combina com a busca.</p>
        )}
        {!loading &&
          orderedRecipes.map((recipe) => {
            const ingredientCount = recipe.ingredients?.length ?? 0;
            return (
              <article key={recipe.id} className={styles.card}>
                <div onClick={() => handleSelectRecipe(recipe)} style={{ flex: 1 }}>
                  <div className={styles.cardTitle}>{recipe.name}</div>
                  <small className={styles.cardMeta}>
                    {ingredientCount} {ingredientCount === 1 ? "ingrediente" : "ingredientes"}
                  </small>
                </div>
                <button
                  aria-label="Marcar favorito"
                  className={`${styles.starButton} ${recipe.favorite ? styles.favorite : ""}`}
                  onClick={() => void handleFavoriteToggle(recipe)}
                >
                <Star
                  size={18}
                  aria-hidden="true"
                  fill={recipe.favorite ? "currentColor" : "none"}
                  stroke="currentColor"
                />
              </button>
              <button className={styles.starButton} onClick={() => openEdit(recipe)} aria-label="Editar">
                <Pencil size={16} aria-hidden="true" />
              </button>
                <button
                  className={`${styles.starButton} ${styles.deleteButton}`}
                  aria-label="Excluir"
                  onClick={() => void handleDeleteRecipe(recipe)}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </article>
            );
          })}
      </section>

      {selectedRecipe && (
        <div className={styles.recipePanel} role="dialog" aria-modal="true">
          <div className={styles.panelContent}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>{selectedRecipe.name}</h2>
              <div className={styles.panelActions}>
                <button className={styles.closeButton} onClick={() => setSelectedId(null)} aria-label="Fechar painel">
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div>
              <div className={styles.sectionTitle}>INGREDIENTES</div>
              <ul style={{ paddingLeft: "1.2rem", marginTop: 8 }}>
                {(Array.isArray(selectedRecipe.ingredients) ? selectedRecipe.ingredients : []).map((item) => (
                  <li key={item} className={styles.paragraph}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className={styles.sectionTitle}>PREPARO</div>
              <p className={styles.paragraph}>{selectedRecipe.preparo}</p>
            </div>
            <div>
              <div className={styles.sectionTitle}>FINALIZAÇÃO</div>
              <p className={styles.paragraph}>{selectedRecipe.finalizacao}</p>
            </div>
          </div>
        </div>
      )}

      {formOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle}>{formState.id ? "Editar receita" : "Nova receita"}</h2>

            <label className={styles.fieldGroup}>
              <span className={styles.label}>Nome</span>
              <input
                className={styles.input}
                value={formState.name}
                onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
              />
            </label>

            <label className={styles.fieldGroup}>
              <span className={styles.label}>Ingredientes (um por linha)</span>
              <textarea
                className={`${styles.textarea}`}
                value={formState.ingredientsText}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, ingredientsText: event.target.value }))
                }
              />
            </label>

            <label className={styles.fieldGroup}>
              <span className={styles.label}>Preparo</span>
              <textarea
                className={`${styles.textarea}`}
                value={formState.preparo}
                onChange={(event) => setFormState((prev) => ({ ...prev, preparo: event.target.value }))}
              />
            </label>

            <label className={styles.fieldGroup}>
              <span className={styles.label}>Finalização</span>
              <input
                className={styles.input}
                value={formState.finalizacao}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, finalizacao: event.target.value }))
                }
              />
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={formState.favorite}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, favorite: event.target.checked }))
                }
              />
              <span className={styles.label}>Favorito</span>
            </label>

            <div className={styles.buttonsRow}>
              <button className={styles.secondaryBtn} onClick={closeForm}>
                <X size={16} aria-hidden="true" />
                <span>Cancelar</span>
              </button>
              <button
                className={styles.primaryBtn}
                onClick={handleSaveRecipe}
                disabled={saving}
              >
                <Check size={16} aria-hidden="true" />
                <span>{saving ? "Salvando..." : "Salvar"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalTopBar}>
              <h2 className={styles.modalTitle}>Importar receita</h2>
              <button
                type="button"
                className={styles.modalCloseIcon}
                onClick={closeImport}
                aria-label="Fechar importação"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <label className={styles.fieldGroup}>
              <span className={styles.label}>Cole aqui o texto bruto</span>
              <textarea
                className={`${styles.textarea} ${styles.importArea}`}
                value={importText}
                onChange={(event) => {
                  setImportText(event.target.value);
                  setImportError(null);
                  setImportInfo(null);
                }}
                onPaste={handleImportPaste}
              />
            </label>
            <div className={styles.importHelper}>
              <p className={styles.importHint}>
                Prefere usar uma imagem? Arraste/solte, clique abaixo, abra a câmera ou simplesmente cole a foto da
                receita para extrairmos o texto automaticamente.
              </p>
              <label
                className={styles.dropzone}
                onDragOver={handleImportDragOver}
                onDrop={handleImportDrop}
              >
                <input
                  ref={importFileInputRef}
                  type="file"
                  accept="image/*"
                  className={styles.hiddenInput}
                  onChange={handleFileInputChange}
                />
                <span className={styles.dropzoneIcon}>
                  <ImageDown size={20} aria-hidden="true" />
                </span>
                <span className={styles.dropzoneTitle}>Clique aqui ou solte uma imagem</span>
                <span className={styles.dropzoneHint}>Formatos compatíveis: JPG, PNG, HEIC</span>
              </label>
              <button
                type="button"
                className={styles.cameraButton}
                onClick={() => void openCameraCapture()}
                disabled={cameraLoading || cameraOpen}
              >
                <Camera size={16} aria-hidden="true" />
                <span>{cameraLoading ? "Abrindo câmera..." : cameraOpen ? "Câmera ativa" : "Importar com a câmera"}</span>
              </button>
              {cameraError && <p className={styles.error}>{cameraError}</p>}
              {cameraOpen && (
                <div className={styles.cameraPreview}>
                  <video ref={cameraVideoRef} playsInline autoPlay muted />
                  <div className={styles.cameraActions}>
                    <button type="button" className={styles.secondaryBtn} onClick={closeCameraCapture}>
                      <X size={16} aria-hidden="true" />
                      <span>Cancelar câmera</span>
                    </button>
                    <button type="button" className={styles.primaryBtn} onClick={() => void handleCameraCapture()}>
                      <Camera size={16} aria-hidden="true" />
                      <span>Capturar</span>
                    </button>
                  </div>
                </div>
              )}
              {importImagePreview && (
                <div className={styles.imagePreview}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={importImagePreview} alt="Prévia da imagem importada" />
                  <div className={styles.previewActions}>
                    <span className={styles.previewLabel}>{importImageFile?.name ?? "Imagem colada"}</span>
                    <button type="button" className={styles.secondaryBtn} onClick={handleClearImportImage}>
                      <Trash2 size={16} aria-hidden="true" />
                      <span>Remover imagem</span>
                    </button>
                  </div>
                </div>
              )}
              {ocrLoading && (
                <div className={styles.progressWrapper}>
                  <div className={styles.progressBar}>
                    <div style={{ width: `${Math.round(ocrProgress * 100)}%` }} />
                  </div>
                  <small className={styles.progressText}>
                    Extraindo texto... {Math.round(ocrProgress * 100)}%
                  </small>
                </div>
              )}
              {ocrError && <p className={styles.error}>{ocrError}</p>}
              {importInfo && <p className={styles.success}>{importInfo}</p>}
            </div>
            {importError && <p className={styles.error}>{importError}</p>}
            <div className={styles.buttonsRow}>
              <button
                className={styles.primaryBtn}
                onClick={() => void handleImportApply()}
                disabled={importTransforming}
              >
                <Wand2 size={16} aria-hidden="true" />
                <span>{importTransforming ? "Transformando..." : "Transformar"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {(speechError || speechTranscript) && (
        <div className={styles.voiceFeedback}>
          {speechError && <p className={styles.error}>{speechError}</p>}
          {speechTranscript && (
            <p className={styles.success}>
              Capturamos: <strong>{speechTranscript}</strong>
            </p>
          )}
          {speechTranscript && (
            <button type="button" className={styles.voiceClear} onClick={() => setSpeechTranscript("")}>Limpar voz</button>
          )}
        </div>
      )}
    </main>
  );
}
