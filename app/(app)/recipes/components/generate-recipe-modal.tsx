"use client";

import { Sparkles, X } from "lucide-react";

import styles from "../recipes.module.css";

type GenerateRecipeModalProps = {
  open: boolean;
  title: string;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onTitleChange: (value: string) => void;
  onApply: () => void;
};

export default function GenerateRecipeModal({
  open,
  title,
  loading,
  error,
  onClose,
  onTitleChange,
  onApply
}: GenerateRecipeModalProps) {
  if (!open) return null;

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalTopBar}>
          <h2 className={styles.modalTitle}>Gerar receita por IA</h2>
          <button type="button" className={styles.modalCloseIcon} onClick={onClose} aria-label="Fechar geração">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <label className={styles.fieldGroup}>
          <span className={styles.label}>Título da receita</span>
          <input
            className={styles.input}
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Ex: Bolo de cenoura fofinho"
          />
        </label>

        <p className={styles.importHint}>
          O fluxo gera uma receita completa no formato do banco e abre o formulário para revisão antes de salvar.
        </p>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.buttonsRow}>
          <button type="button" className={styles.primaryBtn} onClick={onApply} disabled={loading}>
            <Sparkles size={16} aria-hidden="true" />
            <span>{loading ? "Gerando..." : "Gerar receita"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
