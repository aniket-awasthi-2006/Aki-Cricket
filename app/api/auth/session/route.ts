import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createSessionToken,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
  verifyFirebaseIdToken,
} from "@/app/lib/auth-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { idToken?: string };
    const idToken = body.idToken;

    if (!idToken) {
      return NextResponse.json(
        { error: "Missing Firebase id token." },
        { status: 400 },
      );
    }

    const user = await verifyFirebaseIdToken(idToken);
    const sessionToken = await createSessionToken(user);
    const cookieStore = await cookies();

    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

    return NextResponse.json({
      ok: true,
      user: {
        uid: user.uid,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error("Failed to create session", error);
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }
}

export async function DELETE() {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    ...getSessionCookieOptions(),
    maxAge: 0,
  });

  return NextResponse.json({ ok: true });
}
