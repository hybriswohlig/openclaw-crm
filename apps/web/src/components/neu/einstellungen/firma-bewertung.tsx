"use client";

import "@/styles/neu-bewertungen.css";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassInput } from "@/components/glassyui/glass-input";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { FirmenLeiste } from "@/components/neu/bewertungen/firmen-leiste";
import type { BewertungModus } from "@/lib/bewertungen-kunden";
import type { FirmaEinstellungenAnsicht } from "@/lib/einstellungen-uebersicht";
import { Abschnitt, useSpeichern } from "./abschnitt";
import { bewertungModusGesperrt, datumText, googleLinkGueltig, googleRueckfrage } from "./einstellungen-logik";
import { Rueckfrage } from "./rueckfrage";
import { TEXT, type RueckfrageArt } from "./texte";

type Wunsch = { modus?: BewertungModus; hakenPortal?: boolean };

/**
 * (b) Bewertungen und (c) Google-Link. Die Regler sind dieselbe Komponente wie
 * auf /app/bewertungen (`FirmenLeiste`, Plan 11; „Senden“ fragt dort selbst).
 * Hier fragt zusätzlich: Entwurf einschalten, Haken im Portal an. Ohne gültigen
 * Google-Link bleiben Entwurf und Senden gesperrt.
 */
export function FirmaBewertung({
  firma,
  portalZiel,
  onGespeichert,
}: {
  firma: FirmaEinstellungenAnsicht;
  portalZiel: HTMLElement | undefined;
  onGespeichert: () => Promise<void>;
}) {
  const [speichert, setSpeichert] = useState<string | null>(null);
  const [frage, setFrage] = useState<{ arten: RueckfrageArt[]; ja: () => void } | null>(null);
  const [link, setLink] = useState(firma.googleReviewUrl ?? "");
  const s = useSpeichern(onGespeichert);
  useEffect(() => setLink(firma.googleReviewUrl ?? ""), [firma.googleReviewUrl]);

  async function setzen(w: Wunsch) {
    setSpeichert(firma.id);
    const r = await apiAufruf(`/api/v1/bewertungen/firmen/${encodeURIComponent(firma.id)}`, jsonAufruf("PUT", w));
    if (!r.ok) toast.error(TEXT.nichtGespeichert, { description: r.message });
    else toast.success(TEXT.gespeichert);
    await onGespeichert();
    setSpeichert(null);
  }

  function wunsch(w: Wunsch) {
    if (w.modus && bewertungModusGesperrt(w.modus, firma.googleReviewUrl)) {
      toast.error(TEXT.nichtGespeichert, { description: TEXT.googleOhne });
      return;
    }
    if (w.modus === "entwurf" && firma.bewertung.modus === "aus") {
      setFrage({ arten: ["bewertungEntwurf"], ja: () => void setzen(w) });
      return;
    }
    if (w.hakenPortal === true) {
      setFrage({ arten: ["hakenPortal"], ja: () => void setzen(w) });
      return;
    }
    void setzen(w);
  }

  const linkGespeichert = firma.googleReviewUrl ?? "";
  const linkFehler = link.trim() !== "" && !googleLinkGueltig(link) ? "Bitte eine vollständige http(s)-Adresse eintragen." : null;
  const linkAktiv = !s.laeuft && linkFehler === null && link.trim() !== linkGespeichert;

  function linkSenden() {
    void s.speichern(() =>
      apiAufruf(
        `/api/v1/customer-portal-settings/${encodeURIComponent(firma.id)}`,
        jsonAufruf("PUT", { googleReviewUrl: link.trim() === "" ? null : link.trim() }),
      ),
    );
  }

  return (
    <>
      <Abschnitt
        titel={TEXT.bewertung}
        satz={
          <>
            {firma.bewertung.modus !== "aus" && firma.bewertung.seit
              ? `${TEXT.bewertungSeit} ${datumText(firma.bewertung.seit)}. `
              : null}
            <Link href="/app/bewertungen">{TEXT.bewertungSeite}</Link>
          </>
        }
        aktiv={false}
        laeuft={false}
        fehler={null}
        ohneKnopf
        kinder={
          <FirmenLeiste
            firmen={[
              {
                id: firma.id,
                name: firma.name,
                marke: firma.marke,
                modus: firma.bewertung.modus,
                modusSeit: firma.bewertung.seit,
                googleLink: googleLinkGueltig(firma.googleReviewUrl),
                hakenPortal: firma.bewertung.hakenPortal,
              },
            ]}
            darfRegeln
            portalZiel={portalZiel}
            speichert={speichert}
            onSetzen={(_id, w) => wunsch(w)}
          />
        }
      />
      <Abschnitt
        titel={TEXT.googleLink}
        aktiv={linkAktiv}
        laeuft={s.laeuft}
        fehler={s.fehler}
        hinweis={linkFehler}
        onSpeichern={() => {
          const art = googleRueckfrage(firma.googleReviewUrl, link);
          if (art) setFrage({ arten: [art], ja: linkSenden });
          else linkSenden();
        }}
        kinder={
          <div className="einst-zeile">
            <div className="einst-wachsen">
              <GlassInput
                aria-label={TEXT.googleLink}
                type="url"
                inputMode="url"
                placeholder={TEXT.googlePlatzhalter}
                value={link}
                onChange={(e) => setLink(e.target.value)}
                aria-invalid={linkFehler !== null}
              />
            </div>
            <GlassButton
              type="button"
              size="sm"
              variant="ghost"
              disabled={!googleLinkGueltig(link)}
              onClick={() => window.open(link.trim(), "_blank", "noopener,noreferrer")}
            >
              {TEXT.googleTesten}
            </GlassButton>
          </div>
        }
      />
      <Rueckfrage
        arten={frage?.arten ?? null}
        portalZiel={portalZiel}
        onNein={() => setFrage(null)}
        onJa={() => {
          const ja = frage?.ja;
          setFrage(null);
          ja?.();
        }}
      />
    </>
  );
}
