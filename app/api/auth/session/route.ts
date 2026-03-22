import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, destroySessionCookie, verifySessionToken } from "@/lib/session";

const notAuthenticated = () => {
  const response = NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  response.cookies.set(destroySessionCookie());
  return response;
};

export async function GET() {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return notAuthenticated();
  }

  const session = await verifySessionToken(token);
  if (!session) {
    return notAuthenticated();
  }

  return NextResponse.json({ session }, { status: 200 });
}

export async function DELETE() {
  const response = NextResponse.json({ success: true }, { status: 200 });
  response.cookies.set(destroySessionCookie());
  return response;
}
