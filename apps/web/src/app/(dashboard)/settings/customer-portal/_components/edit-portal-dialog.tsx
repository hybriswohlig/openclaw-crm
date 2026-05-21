"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type {
  OperatingCompanyPortalSettings,
  PortalSettingsUpdate,
} from "@/services/customer-portal-config";

/**
 * Full editor for one operating company's portal settings. Saves via
 * PUT /api/v1/customer-portal-settings/[ocId]. The settings list reloads
 * after a successful save.
 */
export function EditPortalDialog({
  open,
  onOpenChange,
  settings,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: OperatingCompanyPortalSettings;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<PortalSettingsUpdate>(() => snapshotOf(settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(snapshotOf(settings));
      setError(null);
    }
  }, [open, settings]);

  if (!open) return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/customer-portal-settings/${settings.operatingCompanyRecordId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(body.error?.message ?? "Speichern fehlgeschlagen.");
        return;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof PortalSettingsUpdate>(k: K, v: PortalSettingsUpdate[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="max-h-[92svh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-background p-6 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">
              {settings.operatingCompanyName}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Domain & Branding für den Kunden-Status-Link.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-sm text-muted-foreground hover:text-foreground"
            disabled={saving}
          >
            ✕
          </button>
        </div>

        <div className="mt-6 space-y-6">
          <Section title="Domain">
            <Field
              label="Subdomain (z. B. status.kottke-umzuege.de)"
              value={form.customDomain ?? ""}
              onChange={(v) => set("customDomain", v || null)}
              placeholder="status.kottke-umzuege.de"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[11px] text-muted-foreground">
              Nach Speichern erscheint im Karten-Bereich der erforderliche
              DNS-Eintrag. Bitte erst DNS-Setup durchführen, dann auf „Jetzt
              prüfen" klicken.
            </p>
          </Section>

          <Section title="Branding">
            <Row>
              <Field
                label="Anzeigename"
                value={form.displayName ?? ""}
                onChange={(v) => set("displayName", v || null)}
                placeholder={settings.operatingCompanyName}
              />
              <Field
                label="Primärfarbe (Hex)"
                value={form.primaryColor ?? ""}
                onChange={(v) => set("primaryColor", v || null)}
                placeholder="1f3a5f"
              />
            </Row>
            <Field
              label="Logo URL (optional)"
              value={form.logoUrl ?? ""}
              onChange={(v) => set("logoUrl", v || null)}
              placeholder="https://kottke-umzuege.de/logo.png"
            />
            <Field
              label="Footer-Zeile"
              value={form.footerText ?? ""}
              onChange={(v) => set("footerText", v || null)}
              placeholder="Kottke Dienstleistungen · Marktstr. 8 · 72218 Wildberg"
              multiline
            />
          </Section>

          <Section title="Kontakt & Bewertung">
            <Row>
              <Field
                label="WhatsApp-Nummer (E.164)"
                value={form.whatsappNumberE164 ?? ""}
                onChange={(v) => set("whatsappNumberE164", v || null)}
                placeholder="491759498475"
              />
              <Field
                label="Google-Bewertung URL"
                value={form.googleReviewUrl ?? ""}
                onChange={(v) => set("googleReviewUrl", v || null)}
                placeholder="https://g.page/r/.../review"
              />
            </Row>
          </Section>

          <Section title="Zahldaten">
            <Row>
              <Field
                label="IBAN"
                value={form.bankIban ?? ""}
                onChange={(v) => set("bankIban", v || null)}
                placeholder="DE81 1001 8000 0379 5948 02"
              />
              <Field
                label="BIC"
                value={form.bankBic ?? ""}
                onChange={(v) => set("bankBic", v || null)}
                placeholder="FNOMDEB2"
              />
            </Row>
            <Field
              label="Kontoinhaber"
              value={form.bankHolder ?? ""}
              onChange={(v) => set("bankHolder", v || null)}
              placeholder="Darioush Kottke"
            />
            <Field
              label="PayPal-Adresse oder paypal.me-Handle"
              value={form.paypalHandle ?? ""}
              onChange={(v) => set("paypalHandle", v || null)}
              placeholder="kontakt@kottke-umzuege.de  oder  kottke-umzuege"
            />
          </Section>

          <Section title="AGB">
            <Row>
              <Field
                label="AGB-Version"
                value={form.agbVersion ?? ""}
                onChange={(v) => set("agbVersion", v || null)}
                placeholder="kottke-2026-01"
              />
              <Field
                label="AGB-PDF URL"
                value={form.agbPdfUrl ?? ""}
                onChange={(v) => set("agbPdfUrl", v || null)}
                placeholder="/legal/agb-kottke.pdf"
              />
            </Row>
            <p className="text-[11px] text-muted-foreground">
              Die Version wird auf jeder Annahme als legaler Nachweis
              gespeichert. Erhöhe die Version, sobald sich die AGB ändern.
            </p>
          </Section>
        </div>

        {error && (
          <p className="mt-5 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="h-10 flex-1 rounded-xl border border-border bg-transparent text-sm font-medium hover:bg-accent"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-foreground text-sm font-medium text-background hover:opacity-90"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

function snapshotOf(s: OperatingCompanyPortalSettings): PortalSettingsUpdate {
  return {
    enabled: s.enabled,
    customDomain: s.customDomain,
    displayName: s.displayName,
    primaryColor: s.primaryColor,
    logoUrl: s.logoUrl,
    footerText: s.footerText,
    googleReviewUrl: s.googleReviewUrl,
    whatsappNumberE164: s.whatsappNumberE164,
    bankIban: s.bankIban,
    bankBic: s.bankBic,
    bankHolder: s.bankHolder,
    paypalHandle: s.paypalHandle,
    agbVersion: s.agbVersion,
    agbPdfUrl: s.agbPdfUrl,
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  autoComplete,
  spellCheck,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoComplete?: string;
  spellCheck?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          spellCheck={spellCheck}
          className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
        />
      )}
    </label>
  );
}
