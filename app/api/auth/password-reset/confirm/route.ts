import { NextResponse } from "next/server";

import { resetPasswordWithToken } from "@/lib/auth";
import { createSessionCookie, createSessionToken, destroySessionCookie } from "@/lib/session";

const respondWithError = (message: string, status: number) => {
  const response = NextResponse.json({ error: message }, { status });
  if (status >= 400) {
    response.cookies.set(destroySessionCookie());
  }
  return response;
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    console.error("auth/password-reset/confirm: JSON inválido", error);
    return respondWithError("JSON inválido", 400);
  }

  if (!body || typeof body !== "object") {
    return respondWithError("Corpo inválido", 400);
  }

  const payload = body as { token?: unknown; password?: unknown };
  const token = typeof payload.token === "string" ? payload.token.trim() : "";
  const password = typeof payload.password === "string" ? payload.password.trim() : "";

  if (!token) {
    return respondWithError("Informe o código recebido", 422);
  }
  if (!password || password.length < 6) {
    return respondWithError("A nova senha precisa de pelo menos 6 caracteres", 422);
  }

  try {
    const user = await resetPasswordWithToken(token, password);
    const sessionToken = await createSessionToken({ id: user.id, email: user.email });
    const response = NextResponse.json({ user }, { status: 200 });
    response.cookies.set(createSessionCookie(sessionToken));
    return response;
  } catch (error) {
    console.error("auth/password-reset/confirm", error);
    return respondWithError(
      error instanceof Error ? error.message : "Não foi possível redefinir a senha",
      400
    );
  }
}
