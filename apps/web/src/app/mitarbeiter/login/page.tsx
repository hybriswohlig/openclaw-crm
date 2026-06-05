"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get("redirect");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError("Bitte Benutzername und Passwort eingeben.");
      return;
    }

    setLoading(true);
    try {
      const result = await authClient.signIn.username({
        username: username.trim(),
        password,
      });

      if (result?.error) {
        setError("Anmeldung fehlgeschlagen. Bitte Zugangsdaten prüfen.");
        setLoading(false);
        return;
      }

      window.location.href = redirectParam || "/";
    } catch {
      setError("Anmeldung fehlgeschlagen. Bitte erneut versuchen.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex items-center justify-center rounded-2xl bg-white px-6 py-4 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/kottke-umzuege-logo.svg"
              alt="Kottke Umzüge"
              className="h-12 w-auto"
            />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">
              Mitarbeiter-Portal
            </h1>
            <p className="text-base text-muted-foreground">
              Bitte melde dich an, um deine Aufträge zu sehen.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm"
        >
          <div className="space-y-2">
            <label
              htmlFor="username"
              className="block text-sm font-medium text-foreground"
            >
              Benutzername
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base text-foreground outline-none focus:border-primary"
              placeholder="z. B. max.mueller"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-foreground"
            >
              Passwort
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base text-foreground outline-none focus:border-primary"
              placeholder="Dein Passwort"
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground shadow-sm active:scale-[0.99] disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : null}
            <span>{loading ? "Anmelden ..." : "Anmelden"}</span>
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center">
          <Loader2
            className="h-6 w-6 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
