import { SignJWT, jwtVerify } from "jose";

const SESSION_COOKIE_NAME = "lanchinhos_session";
const SESSION_AUDIENCE = "lanchinhos-app";
const SESSION_ISSUER = "lanchinhos-auth";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 dias

type SessionUser = {
  id: string;
  email: string;
};

export type SessionPayload = {
  userId: string;
  email: string;
  expiresAt: number;
};

let encodedSecret: Uint8Array | null = null;

const getSecretKey = () => {
  if (!encodedSecret) {
    let secret = process.env.AUTH_SECRET;
    if (!secret) {
      console.warn("AUTH_SECRET ausente. Usando valor inseguro apenas para desenvolvimento.");
      secret = "insecure-dev-secret";
    }
    encodedSecret = new TextEncoder().encode(secret);
  }
  return encodedSecret;
};

export const createSessionToken = async (user: SessionUser) => {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecretKey());
};

export const verifySessionToken = async (token: string): Promise<SessionPayload | null> => {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE
    });

    const userId = typeof payload.sub === "string" ? payload.sub : null;
    const email = typeof payload.email === "string" ? payload.email : "";
    const expiresAt = typeof payload.exp === "number" ? payload.exp * 1000 : 0;

    if (!userId || !email) {
      return null;
    }

    return { userId, email, expiresAt };
  } catch (error) {
    console.warn("verifySessionToken", error);
    return null;
  }
};

export const createSessionCookie = (token: string) => ({
  name: SESSION_COOKIE_NAME,
  value: token,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE
});

export const destroySessionCookie = () => ({
  name: SESSION_COOKIE_NAME,
  value: "",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 0
});

export { SESSION_COOKIE_NAME, SESSION_MAX_AGE };
