import { createRemoteJWKSet, EncryptJWT, jwtDecrypt, jwtVerify } from "jose";

export const SESSION_COOKIE_NAME = "aki_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 8;
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

export type SessionUser = {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  emailVerified: boolean;
};

type SessionTokenPayload = SessionUser;

function getFirebaseProjectId(): string {
  const projectId =
    process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!projectId) {
    throw new Error(
      "Missing Firebase project id. Set FIREBASE_PROJECT_ID or NEXT_PUBLIC_FIREBASE_PROJECT_ID.",
    );
  }

  return projectId;
}

async function getSessionEncryptionKey(): Promise<Uint8Array> {
  const secret = process.env.AUTH_JWT_SECRET;

  if (!secret) {
    throw new Error("Missing AUTH_JWT_SECRET.");
  }

  const secretBytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", secretBytes);
  return new Uint8Array(digest);
}

export async function verifyFirebaseIdToken(idToken: string): Promise<SessionUser> {
  const projectId = getFirebaseProjectId();

  const { payload } = await jwtVerify(idToken, FIREBASE_JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });

  if (!payload.sub) {
    throw new Error("Firebase token missing subject.");
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
    emailVerified: payload.email_verified === true,
  };
}

export async function createSessionToken(user: SessionTokenPayload): Promise<string> {
  const key = await getSessionEncryptionKey();

  return new EncryptJWT(user)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setSubject(user.uid)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .encrypt(key);
}

export async function verifySessionToken(
  token: string,
): Promise<SessionTokenPayload | null> {
  try {
    const key = await getSessionEncryptionKey();
    const { payload } = await jwtDecrypt(token, key, {
      clockTolerance: "5s",
    });

    if (!payload.sub || typeof payload.sub !== "string") {
      return null;
    }

    return {
      uid: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
      picture: typeof payload.picture === "string" ? payload.picture : undefined,
      emailVerified: payload.emailVerified === true,
    };
  } catch {
    return null;
  }
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
    priority: "high" as const,
  };
}
