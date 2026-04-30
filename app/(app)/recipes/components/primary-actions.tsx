"use client";

import { Sparkles, UploadCloud } from "lucide-react";

import styles from "../recipes.module.css";

type PrimaryActionsProps = {
  onImport: () => void;
  onGenerate: () => void;
  onCreate: () => void;
};

export default function PrimaryActions({ onImport, onGenerate, onCreate }: PrimaryActionsProps) {
  return (
    <div className={styles.actions}>
      <button className={styles.ghostButton} onClick={onImport}>
        <UploadCloud size={18} aria-hidden="true" />
        <span>Importar receita</span>
      </button>
      <button className={styles.ghostButton} onClick={onGenerate}>
        <Sparkles size={18} aria-hidden="true" />
        <span>Gerar por IA</span>
      </button>
      <button className={styles.accentButton} onClick={onCreate}>
        <span>+ Nova Receita</span>
      </button>
    </div>
  );
}
