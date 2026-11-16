"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import type { ApiAntwort } from "@/components/neu/akte/api";
import { tagKurz, uhrzeitKurz } from "@/lib/anzeige";
import type { EinsatzPerson } from "@/lib/einsatz";
import { crewLinkAnlegen, crewLinkErneuern, crewLinkLaden, crewLinkSperren, type CrewLinkAnsicht } from "./mitarbeiter-api";

type Zustand = { art: "laedt" } | { art: "fehler"; meldung: string } | { art: "da"; link: CrewLinkAnsicht | null };
type Frage = "erneuern" | "sperren" | null;

function wann(iso: string): string {
  return `${tagKurz(iso)}, ${uhrzeitKurz(iso)}`;
}

/**
 * Crew-Link einer Person (Crew-Portal): anlegen, kopieren, erneuern (der alte
 * Link geht sofort nicht mehr), sperren, zuletzt geöffnet.
 */
export function CrewLinkKarte({ person }: { person: EinsatzPerson }) {
  const [zustand, setZustand] = useState<Zustand>({ art: "laedt" });
  const [laeuft, setLaeuft] = useState(false);
  const [frage, setFrage] = useState<Frage>(null);

  useEffect(() => {
    let aktiv = true;
    setZustand({ art: "laedt" });
    setFrage(null);
    void crewLinkLaden(person.id).then((r) => {
      if (!aktiv) return;
      setZustand(r.ok ? { art: "da", link: r.data ?? null } : { art: "fehler", meldung: r.message });
    });
    return () => {
      aktiv = false;
    };
  }, [person.id]);

  async function ausfuehren(aufruf: () => Promise<ApiAntwort<CrewLinkAnsicht | null>>, erfolg: string) {
    setLaeuft(true);
    const r = await aufruf();
    setLaeuft(false);
    setFrage(null);
    if (!r.ok) {
      toast.error("Hat nicht geklappt.", { description: r.message });
      return;
    }
    setZustand({ art: "da", link: r.data ?? null });
    toast.success(erfolg);
  }

  async function kopieren(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link kopiert.");
    } catch {
      toast.error("Kopieren ging nicht. Link bitte von Hand markieren.");
    }
  }

  const link = zustand.art === "da" ? zustand.link : null;

  return (
    <div className="ma-abschnitt ma-crew">
      <div className="ma-abschnitt-kopf">
        <h3>Crew-Link</h3>
        {link && !link.aktiv ? <span className="ez-marke">gesperrt</span> : null}
      </div>

      {zustand.art === "laedt" ? <p className="ma-leer">Link wird geladen …</p> : null}
      {zustand.art === "fehler" ? (
        <p className="ma-fehler" role="alert">
          {zustand.meldung}
        </p>
      ) : null}

      {zustand.art === "da" && !person.aktiv && !link ? <p className="ma-hinweis">Nur aktive Personen bekommen einen Link.</p> : null}

      {zustand.art === "da" && person.aktiv && !link ? (
        <>
          <p className="ma-hinweis">Persönlicher Link zu den Jobs. Ohne Passwort, per WhatsApp schicken.</p>
          <div className="ma-knoepfe">
            <GlassButton type="button" size="sm" disabled={laeuft} onClick={() => void ausfuehren(() => crewLinkAnlegen(person.id), "Link angelegt.")}>
              Link anlegen
            </GlassButton>
          </div>
        </>
      ) : null}

      {link ? (
        <>
          {link.aktiv ? (
            <div className="ma-crew-link">
              <input type="text" readOnly value={link.url} aria-label="Crew-Link" onFocus={(e) => e.currentTarget.select()} />
              <GlassButton type="button" size="sm" onClick={() => void kopieren(link.url)}>
                Kopieren
              </GlassButton>
            </div>
          ) : (
            <p className="ma-hinweis">{link.revokedAt ? `Gesperrt seit ${wann(link.revokedAt)}. Der alte Link geht nicht mehr.` : "Gesperrt."}</p>
          )}
          <p className="ma-hinweis">{link.lastSeenAt ? `Zuletzt geöffnet: ${wann(link.lastSeenAt)}` : "Noch nie geöffnet."}</p>

          {frage ? (
            <div className="ez-rueckfrage" role="alertdialog" aria-label="Rückfrage">
              <i aria-hidden="true" />
              <p>
                {frage === "erneuern"
                  ? "Neuen Link machen? Der alte geht dann sofort nicht mehr."
                  : `Link sperren? ${person.name} kommt dann nicht mehr an die Jobs.`}
              </p>
              <div className="ez-rueckfrage-knoepfe">
                <GlassButton type="button" size="sm" variant="ghost" onClick={() => setFrage(null)}>
                  Abbrechen
                </GlassButton>
                <GlassButton
                  type="button"
                  size="sm"
                  disabled={laeuft}
                  onClick={() =>
                    void (frage === "erneuern"
                      ? ausfuehren(() => crewLinkErneuern(person.id), "Neuer Link ist da. Der alte geht nicht mehr.")
                      : ausfuehren(() => crewLinkSperren(person.id), "Link gesperrt."))
                  }
                >
                  {frage === "erneuern" ? "Neuer Link" : "Sperren"}
                </GlassButton>
              </div>
            </div>
          ) : (
            <div className="ma-knoepfe">
              {person.aktiv ? (
                <GlassButton type="button" size="sm" variant="ghost" disabled={laeuft} onClick={() => setFrage("erneuern")}>
                  {link.aktiv ? "Neuer Link …" : "Wieder freigeben mit neuem Link …"}
                </GlassButton>
              ) : null}
              {link.aktiv ? (
                <GlassButton type="button" size="sm" variant="ghost" disabled={laeuft} onClick={() => setFrage("sperren")}>
                  Sperren …
                </GlassButton>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
