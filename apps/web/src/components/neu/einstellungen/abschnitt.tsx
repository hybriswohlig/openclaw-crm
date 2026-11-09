"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import type { ApiAntwort } from "@/components/neu/akte/api";
import { TEXT } from "./texte";

/**
 * Speichern eines Abschnitts (Entscheidung 6): während des Laufs `aria-busy`,
 * bei Fehler bleibt die Eingabe stehen und der Servertext steht darunter,
 * nach Erfolg lädt die Seite neu.
 */
export function useSpeichern(onGespeichert: () => Promise<void> | void) {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function speichern(aufrufe: () => Promise<ApiAntwort<unknown>[] | ApiAntwort<unknown>>, erfolg: string = TEXT.gespeichert) {
    setLaeuft(true);
    setFehler(null);
    const r = await aufrufe();
    const liste = Array.isArray(r) ? r : [r];
    const falsch = liste.find((x) => !x.ok);
    if (falsch && !falsch.ok) {
      setLaeuft(false);
      setFehler(falsch.message);
      toast.error(TEXT.nichtGespeichert, { description: falsch.message });
      if (liste.some((x) => x.ok)) await onGespeichert();
      return false;
    }
    await onGespeichert();
    setLaeuft(false);
    toast.success(erfolg);
    return true;
  }

  return { laeuft, fehler, setFehler, speichern };
}

/** Rahmen eines Abschnitts in der Firmenkarte, mit Knopf „Speichern“ unten rechts. */
export function Abschnitt({
  titel,
  satz,
  kinder,
  aktiv,
  laeuft,
  fehler,
  hinweis,
  onSpeichern,
  ohneKnopf = false,
}: {
  titel: string;
  satz?: ReactNode;
  kinder: ReactNode;
  aktiv: boolean;
  laeuft: boolean;
  fehler: string | null;
  /** Eingabefehler im Browser (vor dem Speichern). */
  hinweis?: string | null;
  onSpeichern?: () => void;
  ohneKnopf?: boolean;
}) {
  return (
    <section className="einst-abschnitt" aria-busy={laeuft || undefined}>
      <div className="einst-abschnitt-kopf">
        <h3>{titel}</h3>
        {satz ? <p className="einst-satz">{satz}</p> : null}
      </div>
      {kinder}
      {hinweis ? (
        <p className="einst-fehler" role="alert">
          {hinweis}
        </p>
      ) : null}
      {fehler ? (
        <p className="einst-fehler" role="alert">
          {fehler}
        </p>
      ) : null}
      {ohneKnopf ? null : (
        <div className="einst-abschnitt-fuss">
          <GlassButton type="button" size="sm" disabled={!aktiv} onClick={onSpeichern} aria-busy={laeuft || undefined}>
            {laeuft ? "Speichert …" : TEXT.speichern}
          </GlassButton>
        </div>
      )}
    </section>
  );
}
