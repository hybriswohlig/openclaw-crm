"use client";

import { useState } from "react";
import { Mail, Check, Loader2 } from "lucide-react";
import {
  portalErrorKey,
  type CustomerEmailStatus,
  type FirmaBranding,
} from "@openclaw-crm/customer-portal-core";
import { useT } from "./portal-i18n";

/**
 * Inline email-capture banner rendered above the acceptance card on Stage 1
 * (and elsewhere) when the lead has no usable email yet. We don't gate the
 * acceptance flow on it — the customer can still accept, the email is
 * optional but recommended.
 *
 * Two trigger states:
 *   missing              → "Wir haben noch keine E-Mail von Ihnen."
 *   kleinanzeigen_relay  → "Wir haben Sie nur über Kleinanzeigen erreicht …"
 *
 * On successful save we don't refetch the full context; we just flip the
 * local UI to a success state and let the next page open pick up the new
 * masked address.
 */
export function EmailCaptureBanner({
  token,
  status,
  branding,
}: {
  token: string;
  status: CustomerEmailStatus;
  branding: FirmaBranding;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "present") return null;
  if (saved) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
        <div className="flex items-center gap-2 font-medium">
          <Check className="h-4 w-4" />
          {t("email.savedTitle")}
        </div>
        <p className="mt-1 text-xs leading-relaxed">{t("email.savedBody")}</p>
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
        setError(t(portalErrorKey(body.error?.code)));
        return;
      }
      setSaved(true);
    } catch {
      setError(t("errors.connection"));
    } finally {
      setSaving(false);
    }
  }

  const isRelay = status === "kleinanzeigen_relay";
  const headline = isRelay
    ? t("email.headlineRelay")
    : t("email.headlineMissing");
  const body = isRelay ? t("email.bodyRelay") : t("email.bodyMissing");

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/40 dark:bg-amber-950/40">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ background: `#${branding.primaryColor}` }}
        >
          <Mail className="h-4 w-4 text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-amber-950 dark:text-amber-100">
            {headline}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
            {body}
          </p>

          {!open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-3 inline-flex h-9 items-center rounded-lg border border-amber-300 bg-white px-3 text-xs font-medium text-amber-950 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100"
            >
              {t("email.cta")}
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
                placeholder={t("email.placeholder")}
                disabled={saving}
                className="h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 dark:border-amber-800 dark:bg-amber-950/60"
                style={{ ["--tw-ring-color" as never]: `#${branding.primaryColor}` }}
              />
              <p className="text-xs text-muted-foreground">
                {t("email.privacyHint")}
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
                  className="h-9 flex-1 rounded-lg border border-amber-300 bg-transparent text-xs font-medium hover:bg-amber-100/50 dark:border-amber-800 dark:hover:bg-amber-950/40"
                >
                  {t("email.cancel")}
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !email.trim()}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: `#${branding.primaryColor}` }}
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t("email.save")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
