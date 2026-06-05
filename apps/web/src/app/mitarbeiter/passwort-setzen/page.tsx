"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2 } from "lucide-react";

function SetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<{ username: string } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("Der Link ist ungültig oder unvollständig.");
      return;
    }
    if (password.length < 8) {
      setError("Das Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    if (password !== confirm) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/v1/portal/account/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (!res.ok) {
        let message = "Passwort konnte nicht gesetzt werden.";
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // Antwort ohne JSON, Standardmeldung beibehalten
        }
        setError(message);
        setLoading(false);
        return;
      }

      const body = (await res.json()) as { data?: { username?: string } };
      setSuccess({ username: body?.data?.username || "" });
      setLoading(false);
    } catch {
      setError("Es ist ein Fehler aufgetreten. Bitte erneut versuchen.");
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">
              Passwort gespeichert
            </h1>
            <p className="text-base text-muted-foreground">
              {success.username
                ? `Du kannst dich jetzt mit dem Benutzernamen "${success.username}" anmelden.`
                : "Du kannst dich jetzt anmelden."}
            </p>
          </div>
          <Link
            href="/login"
            className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground shadow-sm active:scale-[0.99]"
          >
            Zur Anmeldung
          </Link>
        </div>
      </div>
    );
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
              className="h-11 w-auto"
            />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">
              Passwort festlegen
            </h1>
            <p className="text-base text-muted-foreground">
              Lege ein neues Passwort für dein Mitarbeiterkonto fest.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm"
        >
          <div className="space-y-2">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-foreground"
            >
              Neues Passwort
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base text-foreground outline-none focus:border-primary"
              placeholder="Mindestens 8 Zeichen"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="confirm"
              className="block text-sm font-medium text-foreground"
            >
              Passwort bestätigen
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base text-foreground outline-none focus:border-primary"
              placeholder="Passwort wiederholen"
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
            <span>{loading ? "Speichern ..." : "Passwort speichern"}</span>
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Bereits ein Passwort?{" "}
          <Link href="/login" className="font-medium text-primary underline">
            Zur Anmeldung
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SetPasswordPage() {
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
      <SetPasswordForm />
    </Suspense>
  );
}
