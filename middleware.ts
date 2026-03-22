import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, destroySessionCookie, verifySessionToken } from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/manifest.json", "/favicon.ico"];

const isPublicPath = (pathname: string) =>
  PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/images/") || pathname.startsWith("/public/");

const isSessionFreeApi = (pathname: string) => pathname.startsWith("/api/auth") || pathname.startsWith("/api/agent");

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next") || pathname.startsWith("/static")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const isApiRoute = pathname.startsWith("/api");
  const publicRoute = isPublicPath(pathname) || isSessionFreeApi(pathname);

  if (!token) {
    if (publicRoute) {
      return NextResponse.next();
    }
    if (isApiRoute && !isSessionFreeApi(pathname)) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.set(destroySessionCookie());
    return response;
  }

  const session = await verifySessionToken(token);

  if (!session) {
    if (isApiRoute && !isSessionFreeApi(pathname)) {
      const response = NextResponse.json({ error: "Sessão expirada" }, { status: 401 });
      response.cookies.set(destroySessionCookie());
      return response;
    }
    const redirectUrl = new URL("/login", request.url);
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set(destroySessionCookie());
    return response;
  }

  if (!isApiRoute && pathname === "/login") {
    const homeUrl = new URL("/", request.url);
    return NextResponse.redirect(homeUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
