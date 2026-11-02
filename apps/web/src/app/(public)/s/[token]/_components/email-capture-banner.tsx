"use client";

import { useState } from "react";
import { Mail, Check, Loader2 } from "lucide-react";
import type {
  CustomerEmailStatus,
  FirmaBranding,
} from "@openclaw-crm/customer-portal-core";
import {
  emailAdresseHinweis,
  emailCaptureTexte,
  emailFehler,
  emailGespeichertHinweis,
  hinterlegteEmailLabel,
  verbindungsfehler,
} from "@/lib/email-capture-copy";

/**
 * Inline email-capture banner rendered above the acceptance card on Stage 1
 * (and elsewhere) when the lead has no usable email yet. We don't gate the
 * acceptance flow on it — the customer can still accept, the email is
 * optional but recommended.
 *
 * Two trigger states:
 *   missing              → "Wir haben noch keine E-Mail von Ihnen." / "… von dir."
 *   kleinanzeigen_relay  → "Wir haben Sie bisher nur über Kleinanzeigen erreicht." / "… dich …"
 *
 * On successful save we don't refetch the full context; we just flip the
 * local UI to a success state and let the next page open pick up the new
 * masked address.
 */
export function EmailCaptureBanner({
  token,
  status,
  branding,
  onSaved,
  variant = "box",
}: {
  token: string;
  status: CustomerEmailStatus;
  branding: FirmaBranding;
  onSaved?: (masked: string) => void;
  /** "zeile": ruhige Zeile im Brief statt eigenem Kasten. */
  variant?: "box" | "zeile";
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "present") return null;
  if (saved) {
    return (
      <div className="rounded-2xl border border-border bg-[var(--portal-brand-tint)] px-5 py-4 text-sm text-foreground">
        <div className="flex items-center gap-2 font-medium">
          <Check className="h-4 w-4" />
          E-Mail gespeichert
        </div>
        <p className="mt-1 text-xs leading-relaxed">
          {emailGespeichertHinweis(branding.firmaSlug)}
        </p>
      </div>
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/${token}/set-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { code?: string };
        };
        setError(emailFehler(branding.firmaSlug, body.error?.code));
        return;
      }
      const result = await res.json();
      setSaved(true);
      onSaved?.(result.data?.masked ?? hinterlegteEmailLabel(branding.firmaSlug));
    } catch {
      setError(verbindungsfehler(branding.firmaSlug));
    } finally {
      setSaving(false);
    }
  }

  const { headline, body } = emailCaptureTexte(branding.firmaSlug, status, variant);

  return (
    <div className={variant === "zeile" ? "portal-email-zeile" : "rounded-2xl border border-border bg-[var(--portal-brand-tint)] p-5"}>
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ background: `#${branding.primaryColor}` }}
        >
          <Mail className="h-4 w-4 text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {headline}
          </div>
          {variant === "box" && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {body}
            </p>
          )}

          {!open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-3 inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted"
            >
              E-Mail hinterlegen
            </button>
          ) : (
            <div className="mt-3 space-y-2">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ihre.adresse@beispiel.de"
                disabled={saving}
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1"
                style={{ ["--tw-ring-color" as never]: `#${branding.primaryColor}` }}
              />
              <p className="text-xs text-muted-foreground">
                {emailAdresseHinweis(branding.firmaSlug)}
              </p>
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setEmail("");
                    setError(null);
                  }}
                  disabled={saving}
                  className="h-9 flex-1 rounded-lg border border-border bg-transparent text-xs font-medium hover:bg-muted"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !email.trim()}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: `#${branding.primaryColor}` }}
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Speichern
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
