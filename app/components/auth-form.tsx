"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { getFirebaseAuth } from "@/app/lib/firebase-client";

type AuthMode = "login" | "signup";

function getAuthErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Authentication failed. Please try again.";
  }

  const code = (error as Error & { code?: string }).code;

  switch (code) {
    case "auth/email-already-in-use":
      return "This email is already registered.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/weak-password":
      return "Use a stronger password (at least 6 characters).";
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Invalid email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait and try again.";
    case "auth/popup-closed-by-user":
      return "Google sign-in popup was closed before completing.";
    default:
      return "Authentication failed. Please try again.";
  }
}

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const title = useMemo(
    () => (mode === "login" ? "Welcome Back" : "Create Account"),
    [mode],
  );

  const subtitle = useMemo(
    () =>
      mode === "login"
        ? "Log in to continue your cricket analytics journey."
        : "Sign up and start building your cricket dashboard.",
    [mode],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");

    try {
      const auth = getFirebaseAuth();

      if (mode === "signup" && password !== confirmPassword) {
        throw new Error("Passwords do not match.");
      }

      const credential =
        mode === "signup"
          ? await createUserWithEmailAndPassword(auth, email, password)
          : await signInWithEmailAndPassword(auth, email, password);

      if (mode === "signup" && name.length > 0) {
        await updateProfile(credential.user, { displayName: name });
      }

      const idToken = await credential.user.getIdToken(true);
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Could not start secure session.");
      }

      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      if (error instanceof Error && error.message === "Passwords do not match.") {
        setErrorMessage(error.message);
      } else {
        setErrorMessage(getAuthErrorMessage(error));
      }
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
  }

  async function handleGoogleSignIn() {
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const auth = getFirebaseAuth();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      const credential = await signInWithPopup(auth, provider);
      const idToken = await credential.user.getIdToken(true);

      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Could not start secure session.");
      }

      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="w-full max-w-[480px] animate-[panelIn_700ms_ease-out] rounded-3xl border border-white/15 bg-[linear-gradient(180deg,rgba(2,19,45,0.9),rgba(3,12,30,0.86))] p-7 shadow-[0_30px_80px_rgba(2,8,24,0.6)] backdrop-blur-xl sm:p-9">
      <div className="flex items-start justify-end">
        <div className="max-w-[300px] text-right">
          <h1 className="text-4xl font-semibold tracking-tight text-white">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-blue-100/80">{subtitle}</p>
        </div>
      </div>

      <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
        {mode === "signup" ? (
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-blue-100/75">
              Full Name
            </label>
            <input
              name="name"
              type="text"
              placeholder="Virat Kohli"
              className="w-full rounded-2xl border border-blue-200/20 bg-blue-950/40 px-4 py-3 text-white placeholder:text-blue-200/40 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35"
            />
          </div>
        ) : null}

        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-blue-100/75">
            Email
          </label>
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            className="w-full rounded-2xl border border-blue-200/20 bg-blue-950/40 px-4 py-3 text-white placeholder:text-blue-200/40 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-blue-100/75">
            Password
          </label>
          <input
            name="password"
            type="password"
            required
            minLength={6}
            placeholder="Enter password"
            className="w-full rounded-2xl border border-blue-200/20 bg-blue-950/40 px-4 py-3 text-white placeholder:text-blue-200/40 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35"
          />
        </div>

        {mode === "signup" ? (
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-blue-100/75">
              Confirm Password
            </label>
            <input
              name="confirmPassword"
              type="password"
              required
              minLength={6}
              placeholder="Repeat password"
              className="w-full rounded-2xl border border-blue-200/20 bg-blue-950/40 px-4 py-3 text-white placeholder:text-blue-200/40 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35"
            />
          </div>
        ) : null}

        {errorMessage ? (
          <p className="rounded-xl border border-red-300/25 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {errorMessage}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-3 w-full rounded-2xl bg-[linear-gradient(135deg,#18c3ff,#2a75ff_48%,#0f4be8)] px-4 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Please wait..." : mode === "login" ? "Log In" : "Sign Up"}
        </button>

        <div className="relative py-1">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-white/15" />
          </div>
          <p className="relative mx-auto w-fit bg-[#04173b] px-3 text-xs uppercase tracking-[0.2em] text-blue-100/70">
            Or
          </p>
        </div>

        <button
          type="button"
          disabled={isSubmitting}
          onClick={handleGoogleSignIn}
          className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/20 bg-white/95 px-4 py-3 text-sm font-semibold text-[#0f172a] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-7 w-7 shrink-0"
          >
            <path
              d="M12 3.5c-2.32 0-4.42.84-6.05 2.22l2.73 2.73A5.82 5.82 0 0 1 12 7.32c1.33 0 2.54.45 3.5 1.2l2.65-2.65C16.54 4.44 14.43 3.5 12 3.5Z"
              fill="#EA4335"
            />
            <path
              d="M5.95 5.72a8.5 8.5 0 0 0-2.43 4.63h3.55c.16-.58.44-1.12.81-1.63L5.95 5.72Z"
              fill="#FBBC05"
            />
            <path
              d="M4.08 12c0 .75.13 1.48.37 2.16h3.55a5.84 5.84 0 0 1-.18-1.43c0-.51.07-1 .19-1.43H4.45c-.24.68-.37 1.4-.37 2.16Z"
              fill="#4285F4"
            />
            <path
              d="M5.95 18.28A8.48 8.48 0 0 0 12 20.5c2.37 0 4.44-.82 6.03-2.22l-2.86-2.25c-.84.56-1.89.89-3.17.89-1.6 0-3.07-.81-3.95-2.03L5.95 18.28Z"
              fill="#34A853"
            />
            <path
              d="M19.63 12c0-.55-.05-1.08-.14-1.59H12v3.18h4.25a3.6 3.6 0 0 1-1.57 2.1l2.86 2.25C18.87 16.62 19.63 14.49 19.63 12Z"
              fill="#4285F4"
            />
            <path
              d="M12 7.32c1.33 0 2.54.45 3.5 1.2l2.65-2.65A8.43 8.43 0 0 0 12 3.5c-2.32 0-4.42.84-6.05 2.22l2.73 2.73A5.82 5.82 0 0 1 12 7.32Z"
              fill="none"
            />
          </svg>
          <span>{isSubmitting ? "Please wait..." : "Continue with Google"}</span>
        </button>
      </form>

      <p className="mt-5 text-sm text-blue-100/80">
        {mode === "login" ? "New here?" : "Already have an account?"}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setErrorMessage(null);
          }}
          className="font-semibold text-cyan-300 transition hover:text-cyan-200"
        >
          {mode === "login" ? "Create one now" : "Log in instead"}
        </button>
      </p>
    </section>
  );
}
