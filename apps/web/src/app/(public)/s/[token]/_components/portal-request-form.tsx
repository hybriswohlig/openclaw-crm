"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { kundenText } from "@openclaw-crm/customer-portal-core";

type RequestKind = "reschedule" | "question" | "damage";

function placeholder(kind: RequestKind, firma: string | null | undefined): string {
  if (kind === "question") return kundenText(firma, "Ihre Frage an uns", "Deine Frage an uns");
  if (kind === "damage") return "Was ist beschädigt? Wo ist es aufgefallen?";
  return "Was hat sich geändert? Welche Termine passen besser?";
}

/**
 * Collapsible self service request form for the customer portal. Collapsed it
 * renders a single text link; expanded it shows a card that POSTs to
 * /api/public/[token]/request. For reschedule requests the customer can add
 * up to three preferred dates. Success is remembered for the lifetime of the
 * mount and replaces the form with a confirmation card.
 */
export function PortalRequestForm({
  token,
  firmaSlug = null,
  kind,
  triggerLabel,
  title,
  intro,
  primaryColor,
}: {
  token: string;
  firmaSlug?: string | null;
  kind: RequestKind;
  triggerLabel: string;
  title: string;
  intro?: string;
  primaryColor: string;
}) {
  const t = (sie: string, du: string) => kundenText(firmaSlug, sie, du);
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState<string[]>(["", "", ""]);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (submitting) return;
    const message = text.trim();
    if (!message) {
      setError(t("Bitte beschreiben Sie Ihr Anliegen kurz.", "Bitte beschreibe dein Anliegen kurz."));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const body: {
        kind: RequestKind;
        message: string;
        preferredDates?: string[];
      } = { kind, message };
      if (kind === "reschedule") {
        const preferredDates = dates.filter((d) => d !== "");
        if (preferredDates.length > 0) body.preferredDates = preferredDates;
      }
      const res = await fetch(`/api/public/${token}/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { code?: string };
        } | null;
        setError(errorMessage(firmaSlug, data?.error?.code));
        return;
      }
      setDone(true);
    } catch {
      setError(t("Keine Verbindung. Bitte versuchen Sie es erneut.", "Keine Verbindung. Bitte versuche es erneut."));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-border bg-[var(--portal-brand-tint)] p-5 text-sm text-foreground">
        <div className="font-medium">Anfrage gesendet.</div>
        <p className="mt-1 text-xs">{t("Wir melden uns kurzfristig bei Ihnen.", "Wir melden uns kurzfristig bei dir.")}</p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-4"
      >
        {triggerLabel}
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
      </button>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/50 bg-card">
      <div
        className="px-6 py-3 text-sm font-medium text-white"
        style={{ background: `#${primaryColor}` }}
      >
        {title}
      </div>
      <div className="space-y-4 p-6">
        {intro && <p className="text-xs text-muted-foreground">{intro}</p>}

        {kind === "reschedule" && (
          <div className="space-y-3">
            {dates.map((d, i) => (
              <label key={i} className="block">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Wunschtermin {i + 1}
                </span>
                <input
                  type="date"
                  value={d}
                  onChange={(e) =>
                    setDates((prev) =>
                      prev.map((v, j) => (j === i ? e.target.value : v)),
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                />
              </label>
            ))}
          </div>
        )}

        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("Ihre Nachricht", "Deine Nachricht")}
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            placeholder={placeholder(kind, firmaSlug)}
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
          className="inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: `#${primaryColor}` }}
        >
          {submitting
            ? "Wird gesendet…"
            : kind === "damage"
              ? "Schaden melden"
              : "Anfrage senden"}
        </button>

        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="block min-h-11 w-full text-center text-sm text-muted-foreground underline underline-offset-4"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

function errorMessage(firma: string | null | undefined, code: string | undefined): string {
  const t = (sie: string, du: string) => kundenText(firma, sie, du);
  switch (code) {
    case "INVALID_INPUT":
      return t("Bitte beschreiben Sie Ihr Anliegen kurz.", "Bitte beschreibe dein Anliegen kurz.");
    case "RATE_LIMITED":
      return t("Sie haben bereits mehrere Anfragen gesendet. Wir melden uns schnellstmöglich.", "Du hast bereits mehrere Anfragen gesendet. Wir melden uns schnellstmöglich.");
    case "REVOKED":
    case "NOT_FOUND":
      return "Dieser Link ist nicht mehr aktiv.";
    default:
      return t("Konnte nicht gesendet werden. Bitte versuchen Sie es erneut.", "Konnte nicht gesendet werden. Bitte versuche es erneut.");
  }
}
