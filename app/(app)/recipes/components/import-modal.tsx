"use client";

import { Camera, ImageDown, Mic, Trash2, Wand2, X } from "lucide-react";
import type { ChangeEvent, ClipboardEvent, DragEvent, RefObject } from "react";

import styles from "../recipes.module.css";

type ImportModalProps = {
  open: boolean;
  importText: string;
  importError: string | null;
  importInfo: string | null;
  importTransforming: boolean;
  importImagePreview: string | null;
  importImageFileName: string | null;
  cameraOpen: boolean;
  cameraError: string | null;
  cameraLoading: boolean;
  onClose: () => void;
  onTextChange: (value: string) => void;
  onApply: () => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onImportDragOver: (event: DragEvent<HTMLLabelElement>) => void;
  onImportDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onImportPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onClearImage: () => void;
  onOpenCamera: () => void;
  onCloseCamera: () => void;
  onCaptureFromCamera: () => void;
  importFileInputRef: RefObject<HTMLInputElement>;
  cameraVideoRef: RefObject<HTMLVideoElement>;
  speechActive: boolean;
  onSpeechStart: () => void;
  onSpeechStop: () => void;
};

export default function ImportModal({
  open,
  importText,
  importError,
  importInfo,
  importTransforming,
  importImagePreview,
  importImageFileName,
  cameraOpen,
  cameraError,
  cameraLoading,
  onClose,
  onTextChange,
  onApply,
  onFileChange,
  onImportDragOver,
  onImportDrop,
  onImportPaste,
  onClearImage,
  onOpenCamera,
  onCloseCamera,
  onCaptureFromCamera,
  importFileInputRef,
  cameraVideoRef,
  speechActive,
  onSpeechStart,
  onSpeechStop
}: ImportModalProps) {
  if (!open) return null;

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalTopBar}>
          <h2 className={styles.modalTitle}>Importar receita</h2>
          <button type="button" className={styles.modalCloseIcon} onClick={onClose} aria-label="Fechar importação">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Cole aqui o texto bruto</span>
          <div className={styles.textareaWrapper}>
            <textarea
              className={`${styles.textarea} ${styles.importArea}`}
              value={importText}
              onChange={(event) => onTextChange(event.target.value)}
              onPaste={onImportPaste}
              placeholder="Ex: 500g de farinha, 2 ovos..."
            />
            <button
              type="button"
              className={`${styles.textareaMicButton} ${speechActive ? styles.textareaMicActive : ""}`}
              onClick={() => (speechActive ? onSpeechStop() : onSpeechStart())}
              aria-label={speechActive ? "Parar ditado" : "Ditar receita"}
              title={speechActive ? "Parar ditado" : "Ditar receita"}
            >
              <Mic size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className={styles.importHelper}>
          <p className={styles.importHint}>
            Prefere usar uma imagem? Arraste, solte, clique abaixo, abra a câmera ou cole a foto da receita. A análise
            roda no servidor com visão por IA e fallback de OCR.
          </p>
          <label className={styles.dropzone} onDragOver={onImportDragOver} onDrop={onImportDrop}>
            <input
              ref={importFileInputRef}
              type="file"
              accept="image/*"
              className={styles.hiddenInput}
              onChange={onFileChange}
            />
            <span className={styles.dropzoneIcon}>
              <ImageDown size={20} aria-hidden="true" />
            </span>
            <span className={styles.dropzoneTitle}>Clique aqui ou solte uma imagem</span>
            <span className={styles.dropzoneHint}>Formatos compatíveis: JPG, PNG, HEIC</span>
          </label>
          <button type="button" className={styles.cameraButton} onClick={onOpenCamera} disabled={cameraLoading || cameraOpen}>
            <Camera size={16} aria-hidden="true" />
            <span>{cameraLoading ? "Abrindo câmera..." : cameraOpen ? "Câmera ativa" : "Importar com a câmera"}</span>
          </button>
          {cameraError && <p className={styles.error}>{cameraError}</p>}
          {cameraOpen && (
            <div className={styles.cameraPreview}>
              <video ref={cameraVideoRef} playsInline autoPlay muted />
              <div className={styles.cameraActions}>
                <button type="button" className={styles.secondaryBtn} onClick={onCloseCamera}>
                  <X size={16} aria-hidden="true" />
                  <span>Cancelar câmera</span>
                </button>
                <button type="button" className={styles.primaryBtn} onClick={onCaptureFromCamera}>
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
                <span className={styles.previewLabel}>{importImageFileName ?? "Imagem colada"}</span>
                <button type="button" className={styles.secondaryBtn} onClick={onClearImage}>
                  <Trash2 size={16} aria-hidden="true" />
                  <span>Remover imagem</span>
                </button>
              </div>
            </div>
          )}
          {importInfo && <p className={styles.success}>{importInfo}</p>}
        </div>
        {importError && <p className={styles.error}>{importError}</p>}
        <div className={styles.buttonsRow}>
          <button className={styles.primaryBtn} onClick={onApply} disabled={importTransforming}>
            <Wand2 size={16} aria-hidden="true" />
            <span>{importTransforming ? "Transformando..." : "Transformar"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
