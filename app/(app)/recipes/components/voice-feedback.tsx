"use client";

import styles from "../recipes.module.css";

type VoiceFeedbackProps = {
  error: string | null;
};

export default function VoiceFeedback({ error }: VoiceFeedbackProps) {
  if (!error) {
    return null;
  }

  return (
    <div className={styles.voiceFeedback}>
      <p className={styles.error}>{error}</p>
    </div>
  );
}
