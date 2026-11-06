"use client";

import "@/styles/neu-akte-dock.css";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassDock, GlassDockSeparator } from "@/components/glassyui/glass-dock";
import type { AkteDaten, DockAktion } from "@/lib/akte";
import { apiAufruf, jsonAufruf } from "./api";
import { meldungBearbeiten } from "./zahlungsmeldung";

type Dock = AkteDaten["dock"];
export type DokumentArt = "AB" | "RE";

/** Symbole aus dem Mockup (24er Raster, Strich 1,8). */
const SYMBOL: Record<DockAktion | "kv_anpassen" | "termin" | "vorlage", React.ReactNode> = {
  nachfass_senden: <path d="M4 12l16-7-5 16-3-6z" />,
  zahlung_bestaetigen: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  zahlung_erfassen: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18M7 14h4" />
    </>
  ),
  kv_erstellen: <path d="M4 20h4l10-10-4-4L4 16z" />,
  kv_anpassen: <path d="M4 20h4l10-10-4-4L4 16z" />,
  ab_erstellen: <path d="M6 3h9l5 5v13H6z M14 3v6h6" />,
  rechnung_erstellen: <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z M9 8h6M9 12h6" />,
  bewertung_anfragen: <path d="M12 3l2.8 6 6.2.7-4.6 4.3 1.3 6.3L12 17l-5.7 3.3 1.3-6.3L3 9.7 9.2 9z" />,
  nachricht_schreiben: <path d="M4 5h16v11H9l-5 4z" />,
  termin: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  vorlage: <path d="M4 6h16M4 12h10M4 18h7" />,
};

function Symbol({ art }: { art: keyof typeof SYMBOL }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {SYMBOL[art]}
    </svg>
  );
}

/** Deutsche Texte zu den Fehlercodes von PATCH /agent-drafts/{id} (approve_and_send). */
const NACHFASS_FEHLER: Record<string, string> = {
  stale: "Der Kunde hat inzwischen geschrieben. Der Entwurf ist veraltet und wurde nicht gesendet.",
  expired: "Der Entwurf ist abgelaufen.",
  not_pending: "Der Entwurf ist nicht mehr offen.",
  no_conversation: "Zum Entwurf gibt es kein Gespräch mehr.",
  gate_blocked: "Senden gesperrt: der Kunde möchte keine Nachrichten oder das Gespräch ist pausiert.",
  price_leak: "Der Entwurf nennt einen Preis oder eine Zusage und wurde nicht gesendet.",
  session_expired: "Die WhatsApp-Sitzung ist abgelaufen.",
  send_uncertain: "Senden unklar. Bitte im Gespräch prüfen, bevor erneut gesendet wird.",
  send_failed: "Senden fehlgeschlagen.",
};

/**
 * Das Dock unten mittig über dem Gespräch (Mockup .dock): Hauptknopf als blauer
 * Slab mit `dock.primaer.label`, Trenner, dann KV anpassen, AB erstellen
 * (gesperrt ohne `abErlaubt`), Rechnung (gesperrt ohne `rechnungErlaubt`),
 * Termin und Vorlage (nur mit direkt verknüpftem WABA-Gespräch).
 *
 * Hauptknopf: `nachfass_senden` gibt den Entwurf frei und sendet ihn
 * (`approve_and_send`, `humanApproved`; der Server nimmt den Entwurfstext, so
 * greift seine Prüfung auf eine neuere Kundennachricht); `zahlung_bestaetigen`
 * mit Ziel bestätigt direkt, ohne Ziel öffnet es den Zahlungsdialog;
 * `zahlung_erfassen` den Zahlungsdialog; `kv_erstellen` führt zur alten
 * Kalkulation; `ab_erstellen`/`rechnung_erstellen` öffnen den Dokument-Dialog;
 * `bewertung_anfragen` den Bewertungsdialog; `nachricht_schreiben` setzt den
 * Fokus ins Eingabefeld.
 *
 * Passt die Leiste nicht in die Breite (Handy), scrollt sie seitlich; ein
 * Verlauf am rechten Rand (`data-weiter`) zeigt, dass dort noch Knöpfe sind.
 */
export function AkteDock({
  dealId,
  dock,
  kvLink,
  hatWaba,
  onZahlung,
  onBewertung,
  onDokument,
  onTermin,
  onVorlage,
  onNachricht,
  onNeuLaden,
}: {
  dealId: string;
  dock: Dock;
  kvLink: string;
  hatWaba: boolean;
  onZahlung: () => void;
  onBewertung: () => void;
  onDokument: (art: DokumentArt) => void;
  onTermin: () => void;
  onVorlage: () => void;
  onNachricht: () => void;
  onNeuLaden: () => Promise<void> | void;
}) {
  const [laeuft, setLaeuft] = useState(false);
  const [weiter, setWeiter] = useState(false);
  const rolle = useRef<HTMLDivElement | null>(null);

  /** Gibt es rechts noch verdeckte Knöpfe? */
  const weiterPruefen = useCallback(() => {
    const el = rolle.current;
    if (!el) return;
    setWeiter(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    weiterPruefen();
    window.addEventListener("resize", weiterPruefen);
    return () => window.removeEventListener("resize", weiterPruefen);
  }, [weiterPruefen, dock.primaer.label, hatWaba]);

  async function nachfassSenden(entwurfId: string) {
    setLaeuft(true);
    const r = await apiAufruf<{ sent: boolean }>(
      `/api/v1/agent-drafts/${entwurfId}`,
      jsonAufruf("PATCH", { action: "approve_and_send", humanApproved: true })
    );
    if (r.ok) {
      toast.success("Nachfass gesendet.");
    } else {
      // Die Route antwortet `{ error: "stale" }`; der Code steht dann in der Meldung.
      const text = NACHFASS_FEHLER[r.code ?? ""] ?? NACHFASS_FEHLER[r.message] ?? r.message;
      toast.error("Nachfass nicht gesendet.", { description: text });
    }
    if (r.ok || r.status !== 0) await onNeuLaden();
    setLaeuft(false);
  }

  async function bestaetigen(eventId: string) {
    setLaeuft(true);
    const { neuLaden } = await meldungBearbeiten(dealId, eventId, "bestaetigen");
    if (neuLaden) await onNeuLaden();
    setLaeuft(false);
  }

  function primaerKlick() {
    const p = dock.primaer;
    switch (p.aktion) {
      case "nachfass_senden":
        if (p.ziel) void nachfassSenden(p.ziel);
        else onNachricht();
        return;
      case "zahlung_bestaetigen":
        if (p.ziel) void bestaetigen(p.ziel);
        else onZahlung();
        return;
      case "zahlung_erfassen":
        onZahlung();
        return;
      case "ab_erstellen":
        onDokument("AB");
        return;
      case "rechnung_erstellen":
        onDokument("RE");
        return;
      case "bewertung_anfragen":
        onBewertung();
        return;
      case "kv_erstellen":
        // Als Link gerendert, siehe unten.
        return;
      case "nachricht_schreiben":
        onNachricht();
    }
  }

  const primaer = dock.primaer;

  return (
    <div className="akte-dock" data-weiter={weiter || undefined}>
      <div ref={rolle} className="akte-dock-rolle" role="toolbar" aria-label="Aktionen" onScroll={weiterPruefen}>
        <GlassDock className="akte-dock-leiste">
          {primaer.aktion === "kv_erstellen" ? (
            <Link href={kvLink} className="akte-dock-knopf akte-dock-primaer">
              <Symbol art="kv_erstellen" />
              {primaer.label}
            </Link>
          ) : (
            <button
              type="button"
              className="akte-dock-knopf akte-dock-primaer"
              aria-busy={laeuft || undefined}
              disabled={laeuft}
              onClick={primaerKlick}
            >
              <Symbol art={primaer.aktion} />
              {laeuft ? "Läuft …" : primaer.label}
            </button>
          )}
          <GlassDockSeparator />
          <Link href={kvLink} className="akte-dock-knopf">
            <Symbol art="kv_anpassen" />
            KV anpassen
          </Link>
          <DockKnopf art="ab_erstellen" label="AB erstellen" gesperrt={dock.abErlaubt ? null : "Erst nach der Annahme"} onClick={() => onDokument("AB")} />
          <DockKnopf art="rechnung_erstellen" label="Rechnung" gesperrt={dock.rechnungErlaubt ? null : "Erst ab Geplant"} onClick={() => onDokument("RE")} />
          <DockKnopf art="termin" label="Termin" gesperrt={null} onClick={onTermin} />
          {hatWaba ? <DockKnopf art="vorlage" label="Vorlage" gesperrt={null} onClick={onVorlage} /> : null}
        </GlassDock>
      </div>
    </div>
  );
}

/**
 * Nebenknopf. Gesperrt bleibt er fokussierbar (`aria-disabled`), nennt den
 * Grund als Titel und zeigt ihn beim Klick als Hinweis, auch am Handy.
 */
function DockKnopf({
  art,
  label,
  gesperrt,
  onClick,
}: {
  art: keyof typeof SYMBOL;
  label: string;
  gesperrt: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="akte-dock-knopf"
      aria-disabled={gesperrt ? "true" : undefined}
      aria-label={gesperrt ? `${label}, gesperrt: ${gesperrt}` : undefined}
      title={gesperrt ?? undefined}
      onClick={() => {
        if (gesperrt) toast.message(label, { description: gesperrt });
        else onClick();
      }}
    >
      <Symbol art={art} />
      {label}
    </button>
  );
}
