"use client";

import { useState } from "react";
import { Star, Loader2 } from "lucide-react";
import type {
  CrewMember,
  FirmaBranding,
} from "@openclaw-crm/customer-portal-core";

/**
 * Lets the customer rate each crew member separately (1-5 stars + an optional
 * comment per person OR a single shared comment). Submits via
 * POST /api/public/[token]/rate-crew.
 *
 * Server is the source of truth — it deletes any prior rating for the same
 * (deal, employee) on submit, so the customer can come back and revise.
 */
export function CrewRatingSection({
  token,
  crew,
  branding,
}: {
  token: string;
  crew: CrewMember[];
  branding: FirmaBranding;
}) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (crew.length === 0) return null;

  async function submit() {
    if (submitting) return;
    const ratings = crew
      .map((c) => ({
        employeeId: c.employeeId,
        stars: scores[c.employeeId] ?? 0,
        comment: comment.trim() || null,
      }))
      .filter((r) => r.stars >= 1 && r.stars <= 5);

    if (ratings.length === 0) {
      setError("Bitte vergib mindestens eine Bewertung.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/${token}/rate-crew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratings }),
      });
      if (!res.ok) {
        setError("Bewertung konnte nicht gespeichert werden.");
        return;
      }
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
        <div className="font-medium">Danke für dein Feedback!</div>
        <p className="mt-1 text-xs">
          {branding.googleReviewUrl
            ? "Wenn alles geklappt hat, freuen wir uns über eine öffentliche Google-Bewertung. Der Button dazu erscheint direkt darunter."
            : "Wir geben dein Feedback an die Crew weiter."}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border/50 bg-card">
      <div
        className="px-6 py-3 text-sm font-medium text-white"
        style={{ background: `#${branding.primaryColor}` }}
      >
        Wie war eure Crew?
      </div>
      <div className="space-y-4 p-6">
        <ul className="space-y-3">
          {crew.map((c) => (
            <li
              key={c.employeeId}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/50 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-3">
                {c.photoBase64DataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.photoBase64DataUrl}
                    alt={c.name}
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium text-white"
                    style={{ background: `#${branding.primaryColor}` }}
                  >
                    {c.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.role}</div>
                </div>
              </div>
              <StarPicker
                value={scores[c.employeeId] ?? 0}
                onChange={(v) =>
                  setScores((s) => ({ ...s, [c.employeeId]: v }))
                }
                primaryColor={branding.primaryColor}
              />
            </li>
          ))}
        </ul>

        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Kommentar (optional)
          </span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            placeholder="Was lief gut? Wo können wir besser werden?"
          />
        </label>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: `#${branding.primaryColor}` }}
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Bewertung abschicken
        </button>
      </div>
    </section>
  );
}

function StarPicker({
  value,
  onChange,
  primaryColor,
}: {
  value: number;
  onChange: (v: number) => void;
  primaryColor: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const active = n <= value;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n === value ? 0 : n)}
            aria-label={`${n} Stern${n === 1 ? "" : "e"}`}
            className="p-1 transition-transform hover:scale-110"
          >
            <Star
              className="h-5 w-5"
              fill={active ? `#${primaryColor}` : "transparent"}
              stroke={active ? `#${primaryColor}` : "currentColor"}
              strokeWidth={1.5}
              style={!active ? { color: "var(--muted-foreground)" } : undefined}
            />
          </button>
        );
      })}
    </div>
  );
}
