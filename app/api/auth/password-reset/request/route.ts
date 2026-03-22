import { NextResponse } from "next/server";

import { createPasswordResetToken } from "@/lib/auth";

const respond = (message: string, token?: string, expiresAt?: number) =>
  NextResponse.json(
    {
      message,
      token: process.env.NODE_ENV === "development" ? token : undefined,
      expiresAt
    },
    { status: 200 }
  );

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    console.error("auth/password-reset/request: JSON inválido", error);
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const payload = body as { email?: unknown };
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";

  if (!email) {
    return NextResponse.json({ error: "Informe o email" }, { status: 422 });
  }

  try {
    const { token, expiresAt } = await createPasswordResetToken(email);
    return respond("Se o email existir, enviamos o código de recuperação.", token, expiresAt);
  } catch (error) {
    console.error("auth/password-reset/request", error);
    // Evita revelar se o email existe ou não
    return respond("Se o email existir, enviamos o código de recuperação.");
  }
}
