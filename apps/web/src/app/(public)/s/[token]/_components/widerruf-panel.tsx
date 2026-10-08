"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CheckCircle2, Undo2 } from "lucide-react";
import {
  BUTTON_VERTRAG_WIDERRUFEN,
  BUTTON_WIDERRUF_BESTAETIGEN,
  type CustomerPortalContext,
  type WiderrufKanal,
} from "@openclaw-crm/customer-portal-core";
import { formatPortalDate, portalBrandStyle } from "./portal-presentation";
import { PanelHeading } from "./portal-ui";

/**
 * Elektronische Widerrufsfunktion (§ 356a BGB). Während der Frist steht der
 * Button auf jeder Stufe direkt unter dem Kopf. Zwei Schritte: Angaben
 * prüfen (Abs. 2), dann „Widerruf bestätigen“ (Abs. 3).
 */
export function WiderrufPanel({
  token,
  ctx,
  onWiderrufen,
}: {
  token: string;
  ctx: CustomerPortalContext;
  onWiderrufen: () => void | Promise<void>;
}) {
  const w = ctx.widerruf;
  const [open, setOpen] = useState(false);

  if (w.eingegangen) {
    const at = new Date(w.eingegangen.at);
    return (
      <section className="portal-panel portal-widerruf mb-4" aria-live="polite">
        <PanelHeading icon={CheckCircle2} title="Ihr Widerruf ist eingegangen">
          <p>
            Eingegangen am {datumZeit(at)}. Die Eingangsbestätigung haben wir Ihnen geschickt. Wegen bereits
            geleisteter Zahlungen melden wir uns bei Ihnen.
          </p>
        </PanelHeading>
        <p className="text-sm text-muted-foreground">{w.eingegangen.vertrag}</p>
      </section>
    );
  }
  if (!w.aktiv) return null;

  return (
    <section className="portal-panel portal-widerruf mb-4" aria-label="Widerrufsrecht">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm leading-relaxed">
          <strong>Widerrufsrecht:</strong> Sie können diesen Vertrag bis einschließlich{" "}
          {formatPortalDate(w.fristEnde) ?? w.fristEnde} widerrufen.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-11 items-center gap-2 rounded-xl border-2 border-foreground/80 px-4 text-sm font-semibold"
        >
          <Undo2 aria-hidden className="h-4 w-4" />
          {BUTTON_VERTRAG_WIDERRUFEN}
        </button>
      </div>
      <WiderrufDialog token={token} ctx={ctx} open={open} onOpenChange={setOpen} onWiderrufen={onWiderrufen} />
    </section>
  );
}

function standardKanal(w: CustomerPortalContext["widerruf"]): WiderrufKanal {
  if (w.emailMaskiert) return "email";
  if (w.whatsapp) return "whatsapp";
  return "email_neu";
}

function WiderrufDialog({
  token,
  ctx,
  open,
  onOpenChange,
  onWiderrufen,
}: {
  token: string;
  ctx: CustomerPortalContext;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onWiderrufen: () => void | Promise<void>;
}) {
  const w = ctx.widerruf;
  const [name, setName] = useState(w.name ?? "");
  const [kanal, setKanal] = useState<WiderrufKanal>(standardKanal(w));
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eingegangenAt, setEingegangenAt] = useState<string | null>(null);

  const emailOk = kanal !== "email_neu" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready = name.trim().length > 0 && emailOk && !submitting;

  function handleOpenChange(next: boolean) {
    if (!next && submitting) return;
    if (!next) {
      const fertig = !!eingegangenAt;
      setError(null);
      setEingegangenAt(null);
      if (fertig) void onWiderrufen();
    }
    onOpenChange(next);
  }

  async function submit() {
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/${token}/widerruf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), kanal, email: kanal === "email_neu" ? email.trim() : null }),
      });
      const body = (await res.json().catch(() => ({}))) as { data?: { eingegangenAt?: string }; error?: { code?: string } };
      if (!res.ok || !body.data?.eingegangenAt) {
        setError(fehlerText(body.error?.code));
        return;
      }
      setEingegangenAt(body.data.eingegangenAt);
    } catch {
      setError("Verbindungsfehler. Bitte versuchen Sie es erneut.");
    } finally {
      setSubmitting(false);
    }
  }

  const kanalBeschreibung =
    kanal === "whatsapp" ? "per WhatsApp" : kanal === "email" ? `per E-Mail an ${w.emailMaskiert}` : `per E-Mail an ${email.trim()}`;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm" />
        <DialogPrimitive.Content
          style={portalBrandStyle(ctx.branding.primaryColor)}
          className="kottke-portal portal-widerruf-dialog fixed bottom-0 left-1/2 z-50 max-h-[92svh] w-full max-w-lg -translate-x-1/2 overflow-y-auto rounded-t-3xl bg-background p-6 shadow-2xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
        >
          {eingegangenAt ? (
            <>
              <DialogPrimitive.Title className="text-2xl font-bold tracking-tight">Widerruf eingegangen</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-3 text-sm leading-relaxed">
                Ihr Widerruf ist am {datumZeit(new Date(eingegangenAt))} bei uns eingegangen. Die Eingangsbestätigung
                schicken wir Ihnen {kanalBeschreibung}.
              </DialogPrimitive.Description>
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="mt-6 h-11 w-full rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90"
                style={{ background: `#${ctx.branding.primaryColor}` }}
              >
                Schließen
              </button>
            </>
          ) : (
            <>
              <DialogPrimitive.Title className="text-2xl font-bold tracking-tight">{BUTTON_VERTRAG_WIDERRUFEN}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                Bitte prüfen Sie Ihre Angaben. Erst mit „{BUTTON_WIDERRUF_BESTAETIGEN}“ geht der Widerruf an{" "}
                {ctx.branding.displayName}.
              </DialogPrimitive.Description>

              <div className="mt-5 rounded-xl border border-border/60 bg-card px-4 py-3 text-sm leading-relaxed">
                <p className="font-medium">Hiermit widerrufe ich den folgenden Vertrag:</p>
                <p className="mt-1">{w.vertrag}</p>
              </div>

              <label className="mt-4 block text-sm font-medium" htmlFor="widerruf-name">
                Ihr Name
              </label>
              <input
                id="widerruf-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-base"
              />

              <fieldset className="mt-4">
                <legend className="text-sm font-medium">Eingangsbestätigung an</legend>
                <div className="mt-2 space-y-2">
                  {w.emailMaskiert && (
                    <KanalOption id="widerruf-kanal-email" checked={kanal === "email"} onSelect={() => setKanal("email")}>
                      E-Mail an {w.emailMaskiert}
                    </KanalOption>
                  )}
                  {w.whatsapp && (
                    <KanalOption id="widerruf-kanal-whatsapp" checked={kanal === "whatsapp"} onSelect={() => setKanal("whatsapp")}>
                      WhatsApp an die Nummer, mit der Sie uns schreiben
                    </KanalOption>
                  )}
                  <KanalOption id="widerruf-kanal-neu" checked={kanal === "email_neu"} onSelect={() => setKanal("email_neu")}>
                    {w.emailMaskiert ? "Eine andere E-Mail-Adresse" : "E-Mail-Adresse"}
                  </KanalOption>
                  {kanal === "email_neu" && (
                    <input
                      id="widerruf-email"
                      type="email"
                      aria-label="E-Mail-Adresse für die Eingangsbestätigung"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      placeholder="name@beispiel.de"
                      className="h-11 w-full rounded-xl border border-border bg-background px-3 text-base"
                    />
                  )}
                </div>
              </fieldset>

              {error && (
                <p role="alert" className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => handleOpenChange(false)}
                  disabled={submitting}
                  className="h-11 flex-1 rounded-xl border border-border text-sm font-medium"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!ready}
                  className="h-11 flex-1 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
                  style={{ background: `#${ctx.branding.primaryColor}` }}
                >
                  {submitting ? "Wird gesendet…" : BUTTON_WIDERRUF_BESTAETIGEN}
                </button>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function KanalOption({
  id,
  checked,
  onSelect,
  children,
}: {
  id: string;
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-3 rounded-xl border border-border/50 bg-card px-4 py-3 text-sm">
      <input id={id} type="radio" name="widerruf-kanal" checked={checked} onChange={onSelect} className="h-4 w-4 accent-foreground" />
      <span>{children}</span>
    </label>
  );
}

function datumZeit(d: Date): string {
  const datum = d.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
  const zeit = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
  return `${datum} um ${zeit} Uhr`;
}

function fehlerText(code: string | undefined): string {
  switch (code) {
    case "FRIST_ABGELAUFEN":
      return "Die Widerrufsfrist ist abgelaufen. Bei Fragen schreiben Sie uns gern.";
    case "KANAL_UNAVAILABLE":
      return "Dieser Weg für die Bestätigung ist gerade nicht verfügbar. Bitte geben Sie eine E-Mail-Adresse an.";
    case "KEINE_ANNAHME":
      return "Für diesen Auftrag liegt keine Annahme mehr vor.";
    case "BAD_REQUEST":
      return "Bitte geben Sie Ihren Namen und eine gültige E-Mail-Adresse an.";
    case "REVOKED":
      return "Dieser Link ist nicht mehr aktiv. Bitte schreiben Sie uns Ihren Widerruf per E-Mail.";
    case "NOT_FOUND":
      return "Link nicht gefunden.";
    default:
      return "Es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut oder schreiben Sie uns per E-Mail.";
  }
}
