import { NextResponse } from "next/server";

import { authenticateUser } from "@/lib/auth";
import { createSessionCookie, createSessionToken, destroySessionCookie } from "@/lib/session";

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const respondWithError = (message: string, status: number, field?: "email" | "password") => {
  const response = NextResponse.json({ error: message, field }, { status });
  response.cookies.set(destroySessionCookie());
  return response;
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    console.error("auth/login: JSON inválido", error);
    return respondWithError("JSON inválido", 400);
  }

  if (!body || typeof body !== "object") {
    return respondWithError("Corpo inválido", 400);
  }

  const payload = body as { email?: unknown; password?: unknown };
  const email = typeof payload.email === "string" ? payload.email : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    return respondWithError("Informe seu e-mail", 422, "email");
  }
  if (!isValidEmail(normalizedEmail)) {
    return respondWithError("Formato de e-mail inválido", 422, "email");
  }
  if (!password) {
    return respondWithError("Informe sua senha", 422, "password");
  }

  try {
    const user = await authenticateUser(normalizedEmail, password);
    if (!user) {
      return respondWithError("Credenciais inválidas", 401, "password");
    }

    const token = await createSessionToken({ id: user.id, email: user.email });
    const response = NextResponse.json({ user }, { status: 200 });
    response.cookies.set(createSessionCookie(token));
    return response;
  } catch (error) {
    console.error("auth/login: erro inesperado", error);
    return respondWithError("Erro ao autenticar", 500);
  }
}
