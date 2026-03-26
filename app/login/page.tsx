"use client";

import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import styles from "./page.module.css";

const emailStorageKey = "lanchinhos:lastEmail";

const emailIsValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const wait = (duration = 900) => new Promise((resolve) => setTimeout(resolve, duration));
const registrationFeatureVisible = false;
const googleAuthVisible = false;

type LoginErrorPayload = {
  error?: string;
  field?: "email" | "password";
};

const GoogleIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 533.5 544.3"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={styles.googleSvg}
  >
    <path
      fill="#4285F4"
      d="M533.5 278.4c0-17.4-1.5-34.1-4.3-50.4H272v95.4h147c-6.4 34.5-26.1 63.7-55.6 83.3v69.2h89.6c52.5-48.4 80.5-119.8 80.5-197.5z"
    />
    <path
      fill="#34A853"
      d="M272 544.3c75.7 0 139.3-25.1 185.7-68.4l-89.6-69.2c-24.9 16.7-56.7 26.5-96.1 26.5-73.8 0-136.4-49.8-158.8-116.8H19.9v73.8c46 91.3 140.1 154.1 252.1 154.1z"
    />
    <path
      fill="#FBBC05"
      d="M113.2 316.4c-5.8-17.4-9.1-36-9.1-55.4s3.3-38 9.1-55.4V131.8H19.9C7.3 157.4 0 186.7 0 217.9c0 31.2 7.3 60.5 19.9 86.1l93.3-70.8z"
    />
    <path
      fill="#EA4335"
      d="M272 107.7c41.1 0 77.8 14.2 106.8 42.1l80.1-80.1C411.3 25.9 347.7 0 272 0 160 0 65.9 62.8 19.9 154.1l93.3 73.8C135.6 157.9 198.2 107.7 272 107.7z"
    />
  </svg>
);

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [resetSectionOpen, setResetSectionOpen] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetInfo, setResetInfo] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(emailStorageKey);
      if (stored) {
        setEmail(stored);
      }
    } catch {
      // Storage indisponível (navegação privada, etc.)
    }
  }, []);

  const persistEmail = (value: string) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(emailStorageKey, value);
    } catch {
      // Sem espaço ou bloqueado – ok ignorar
    }
  };

  const resetFieldErrors = () => {
    setEmailError(null);
    setPasswordError(null);
  };

  const clearResetFeedback = () => {
    setResetInfo(null);
    setResetError(null);
  };

  const performAuthAction = async (endpoint: "login" | "register", emailValue: string, passwordValue: string) => {
    setIsBusy(true);
    try {
      const response = await fetch(`/api/auth/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email: emailValue, password: passwordValue })
      });

      const payload: LoginErrorPayload & { user?: { id: string; email: string } } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        const message = payload.error ?? "Não foi possível completar a solicitação";
        if (payload.field === "email") {
          setEmailError(message);
        } else {
          setPasswordError(message);
        }
        return false;
      }

      persistEmail(emailValue);
      setPassword("");
      resetFieldErrors();
      return true;
    } catch (error) {
      console.error(`auth ${endpoint}`, error);
      setPasswordError("Erro ao comunicar com o servidor. Tente novamente.");
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const normalizeCredentials = () => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();

    resetFieldErrors();

    if (!emailIsValid(trimmedEmail)) {
      setEmailError("Informe um e-mail válido para continuar.");
      return null;
    }

    if (trimmedPassword.length < 6) {
      setPasswordError("A senha precisa ter pelo menos 6 caracteres.");
      return null;
    }

    return { trimmedEmail, trimmedPassword };
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const creds = normalizeCredentials();
    if (!creds) return;
    const success = await performAuthAction("login", creds.trimmedEmail, creds.trimmedPassword);
    if (success) {
      router.push("/");
    }
  };

  const handleRegister = async () => {
    const creds = normalizeCredentials();
    if (!creds) return;
    const success = await performAuthAction("register", creds.trimmedEmail, creds.trimmedPassword);
    if (success) {
      router.push("/");
    }
  };

  const handlePasswordResetRequest = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    resetFieldErrors();
    clearResetFeedback();
    setResetSectionOpen(true);
    setResetToken("");
    setNewPassword("");
    if (!emailIsValid(trimmedEmail)) {
      setEmailError("Digite seu e-mail para receber o código de recuperação.");
      return;
    }
    setIsBusy(true);
    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail })
      });
      const data = (await response.json().catch(() => ({}))) as LoginErrorPayload & {
        message?: string;
        token?: string;
      };
      if (!response.ok) {
        setResetError(data.error ?? "Não foi possível enviar o código.");
        return;
      }
      const hint = data.token ? ` Código: ${data.token}` : "";
      setResetInfo((data.message ?? "Se o email existir, enviamos um código.") + hint);
    } catch (error) {
      console.error("password reset request", error);
      setResetError("Erro ao solicitar o código. Tente novamente.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleResetConfirm = async () => {
    clearResetFeedback();
    if (!resetToken.trim()) {
      setResetError("Informe o código recebido por email.");
      return;
    }
    if (!newPassword.trim() || newPassword.trim().length < 6) {
      setResetError("A nova senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    setIsBusy(true);
    try {
      const response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken.trim(), password: newPassword.trim() })
      });
      const data = (await response.json().catch(() => ({}))) as LoginErrorPayload & { user?: { id: string } };
      if (!response.ok) {
        setResetError(data.error ?? "Não foi possível redefinir a senha.");
        return;
      }
      setResetInfo("Senha atualizada! Redirecionando...");
      setResetToken("");
      setNewPassword("");
      router.push("/");
    } catch (error) {
      console.error("password reset confirm", error);
      setResetError("Erro ao redefinir a senha. Tente novamente.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    resetFieldErrors();
    const trimmedEmail = email.trim().toLowerCase();
    if (!emailIsValid(trimmedEmail)) {
      setEmailError("Preencha o e-mail acima para vincular ao Google.");
      return;
    }

    setIsBusy(true);
    try {
      await wait(650);
      persistEmail(trimmedEmail);
      resetFieldErrors();
    } catch {
      setEmailError("Falhou ao iniciar o Google Sign-In. Tente novamente.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className={styles.screen}>
      <section className={styles.device}>
        <div className={styles.heroSection}>
          <div className={styles.heroImage}>
            <Image
              src="/images/cozya-logo.png"
              alt="Logo do Cozya"
              width={402}
              height={231}
              priority
              sizes="(max-width: 480px) 100vw, 420px"
            />
          </div>
          <p className={styles.heroCopy}>Entre para salvar e organizar todas as suas receitas favoritas.</p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <label className={styles.fieldGroup}>
            <span className={styles.label}>Email</span>
            <span className={`${styles.fieldShell} ${emailError ? styles.fieldShellError : ""}`}>
              <input
                className={styles.fieldInput}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="voce@email.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </span>
            {emailError && (
              <span className={styles.inlineError} role="alert">
                {emailError}
              </span>
            )}
          </label>

          <label className={styles.fieldGroup}>
            <span className={styles.label}>Senha</span>
            <span className={`${styles.fieldShell} ${passwordError ? styles.fieldShellError : ""}`}>
              <input
                className={styles.fieldInput}
                type={passwordVisible ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className={styles.showButton}
                onClick={() => setPasswordVisible((prev) => !prev)}
              >
                {passwordVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                <span className="sr-only">{passwordVisible ? "Ocultar senha" : "Mostrar senha"}</span>
              </button>
            </span>
            {passwordError && (
              <span className={styles.inlineError} role="alert">
                {passwordError}
              </span>
            )}
          </label>

          <button type="button" className={styles.forgotLink} onClick={() => void handlePasswordResetRequest()} disabled={isBusy}>
            Esqueci minha senha
          </button>

          {resetSectionOpen && (
            <div className={styles.resetSection}>
              <p className={styles.resetHint}>
                Envie seu email para receber um código e, em seguida, defina sua nova senha aqui mesmo.
              </p>
              {resetInfo && <p className={styles.success}>{resetInfo}</p>}
              {resetError && <p className={styles.error}>{resetError}</p>}
              <label className={styles.fieldGroup}>
                <span className={styles.label}>Código recebido</span>
                <input
                  className={styles.resetInput}
                  value={resetToken}
                  onChange={(event) => setResetToken(event.target.value)}
                  placeholder="Cole o código que recebeu"
                />
              </label>
              <label className={styles.fieldGroup}>
                <span className={styles.label}>Nova senha</span>
                <input
                  className={styles.resetInput}
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="Digite uma nova senha"
                />
              </label>
              <div className={styles.resetActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => void handlePasswordResetRequest()} disabled={isBusy}>
                  Reenviar código
                </button>
                <button type="button" className={styles.primaryButton} onClick={() => void handleResetConfirm()} disabled={isBusy}>
                  Atualizar senha
                </button>
              </div>
            </div>
          )}

          <div className={styles.actions}>
            <button type="submit" className={styles.primaryButton} disabled={isBusy}>
              Entrar
            </button>
            {googleAuthVisible && (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleGoogleSignIn()}
                disabled={isBusy}
              >
                <span className={styles.googleIcon} aria-hidden="true">
                  <GoogleIcon />
                </span>
                <span>Entrar com Google</span>
              </button>
            )}
          </div>
        </form>

        <p className={styles.callout} hidden={!registrationFeatureVisible}>
          Ainda não tem conta?
          <button type="button" className={styles.calloutAction} onClick={() => void handleRegister()} disabled={isBusy}>
            Criar agora
          </button>
        </p>

        <div className={styles.homeIndicator} aria-hidden="true">
          <span />
        </div>
      </section>
    </main>
  );
}
