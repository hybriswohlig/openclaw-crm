"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "@/lib/auth-client";
import { trackEvent } from "@/lib/analytics";
import { NELogo } from "@/components/brand/ne-logo";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

const slogans = [
  "Science with purpose.",
  "Every partnership builds a better world.",
  "Grow further. Impact deeper.",
];

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/home";
<<<<<<< Updated upstream
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
=======
  const reason = searchParams.get("reason");
  const [googleLoading, setGoogleLoading] = useState(false);
>>>>>>> Stashed changes
  const [error, setError] = useState("");

<<<<<<< Updated upstream
  async function handlePostLogin() {
    try {
      const res = await fetch("/api/v1/workspaces");
      if (!res.ok) {
        router.push(redirectTo);
        return;
      }
      const data = await res.json();
      const list = data.data || [];

      if (list.length === 0) {
        const create = await fetch("/api/v1/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "My CRM" }),
        });
        if (!create.ok) {
          router.push(redirectTo);
          return;
        }
      }

      router.push(redirectTo);
    } catch {
      router.push(redirectTo);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
=======
  async function handleGoogleSignIn() {
>>>>>>> Stashed changes
    setError("");
    setGoogleLoading(true);
    try {
<<<<<<< Updated upstream
      const result = await signIn.email({
        email,
        password,
      });

      if (result.error) {
        setError(result.error.message || "Invalid email or password");
      } else {
        trackEvent("login_completed");
        await handlePostLogin();
      }
=======
      await signIn.social({ provider: "google", callbackURL: redirectTo });
      trackEvent("login_completed", { method: "google" });
>>>>>>> Stashed changes
    } catch {
      setError("Sign-in failed. Please try again.");
      setGoogleLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-10">

      {/* Logo */}
      <NELogo className="w-56 dark:invert" />

      {/* Headline */}
      <div className="text-center space-y-2">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground leading-snug">
          Making the world every day
          <br />a better place.
        </h1>
      </div>

<<<<<<< Updated upstream
      <form onSubmit={handleSubmit} className="space-y-4">
=======
      {/* Slogans */}
      <ul className="flex flex-col items-center gap-1.5">
        {slogans.map((s) => (
          <li
            key={s}
            className="text-[13px] text-muted-foreground/60 tracking-wide"
          >
            {s}
          </li>
        ))}
      </ul>

      {/* Sign-in card */}
      <div className="w-full rounded-2xl border border-foreground/[0.06] dark:border-white/[0.06] bg-foreground/[0.015] dark:bg-white/[0.02] px-7 py-7 space-y-4">
        {reason === "rejected" && (
          <p className="rounded-xl bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive text-center">
            Access not approved. Contact{" "}
            <a href="mailto:business@vi-kang.com" className="underline underline-offset-2">
              business@vi-kang.com
            </a>
          </p>
        )}
        {reason === "pending" && (
          <p className="rounded-xl bg-muted/60 px-4 py-2.5 text-[13px] text-foreground/80 text-center">
            Your account is pending approval.
          </p>
        )}
>>>>>>> Stashed changes
        {error && (
          <p className="rounded-xl bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive text-center">
            {error}
          </p>
        )}

        <button
          onClick={handleGoogleSignIn}
          disabled={googleLoading}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-foreground/10 dark:border-white/[0.08] bg-background px-4 py-2.5 text-[14px] font-medium text-foreground transition-all hover:bg-foreground/5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <GoogleIcon />
          {googleLoading ? "Signing in…" : "Continue with Google"}
        </button>

        <p className="text-center text-[11px] text-muted-foreground/40 leading-relaxed pt-1">
          Vi-Kang employees are approved automatically.
          <br />
          All others require admin approval.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
