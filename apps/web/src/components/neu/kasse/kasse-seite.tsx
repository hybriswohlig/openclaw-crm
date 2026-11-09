"use client";

import "@/styles/neu-kasse.css";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassSegmentedControl,
  GlassSegmentedControlItem,
} from "@/components/glassyui/glass-segmented-control";
import { apiAufruf } from "@/components/neu/akte/api";
import { RechnungFluss } from "@/components/neu/akte/rechnung-fluss";
import { ZahlungDialog } from "@/components/neu/akte/zahlung-dialog";
import { seitentitel } from "@/components/neu/nav-config";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import { mitAlt } from "@/lib/handy-links";
import type {
  KasseAntwort,
  KasseSchlange,
  KasseZeile,
  ZahlungAkte,
} from "@/lib/geld";
import type { Zahlungsmeldung } from "@/lib/zahlungsmeldungen";
import { kachelText, schlangenAus } from "./kasse-logik";
import { KasseSchlangeAnsicht } from "./kasse-schlange";

type Zustand =
  | { art: "laden" }
  | { art: "fehler"; meldung: string }
  | { art: "fertig"; antwort: KasseAntwort };
type Offen =
  | { art: "zahlung"; dealId: string; zahlung: ZahlungAkte }
  | { art: "rechnung"; dealId: string };

/** Was der Zahlungsdialog braucht: Rest der Zeile und die offenen Meldungen. */
function zahlungFuerDialog(
  restCent: number | null,
  meldungen: Zahlungsmeldung[],
): ZahlungAkte {
  return {
    restCent,
    gesamtCent: null,
    quelle: "keins",
    meldungen,
    rechnung: null,
    zahlungen: [],
  };
}

/**
 * /app/kasse (Plan 9, Entscheidung 13): vier Warteschlangen in fester Folge
 * (Kunde meldet bezahlt, durchgeführt ohne Rechnung, offener Rest, Anzahlung
 * fehlt), Kacheln nur als Summe je Schlange, Firmenfilter im Kopf. Zeilen
 * öffnen die bestehenden Dialoge: Zahlung erfassen (mit den Meldungen oben),
 * Rechnung erstellen (Rechnungsschritt, dann Dokument). Ausgaben,
 * Gesellschaften und Privatbewegungen bleiben auf der alten Finanzseite.
 */
export function KasseSeite() {
  const portalZiel = usePortalZiel();
  const [firma, setFirma] = useState<string>("alle");
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const [offen, setOffen] = useState<Offen | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const lauf = useRef(0);

  const laden = useCallback(
    async (still = false) => {
      const dieser = ++lauf.current;
      if (!still) setZustand({ art: "laden" });
      const r = await apiAufruf<KasseAntwort>(
        `/api/v1/kasse${firma !== "alle" ? `?firma=${encodeURIComponent(firma)}` : ""}`,
      );
      if (dieser !== lauf.current) return;
      if (r.ok) setZustand({ art: "fertig", antwort: r.data });
      else if (still)
        toast.error("Kasse konnte nicht neu geladen werden.", {
          description: r.message,
        });
      else setZustand({ art: "fehler", meldung: r.message });
    },
    [firma],
  );

  useEffect(() => {
    void laden();
  }, [laden]);

  const neuLaden = useCallback(() => laden(true), [laden]);

  async function aktion(schlange: KasseSchlange, z: KasseZeile) {
    if (schlange === "ohne_rechnung") {
      setOffen({ art: "rechnung", dealId: z.dealId });
      return;
    }
    setLaeuft(`${schlange}:${z.dealId}`);
    const r = await apiAufruf<{ meldungen: Zahlungsmeldung[] }>(
      `/api/v1/deals/${z.dealId}/payment-reports`,
    );
    setLaeuft(null);
    const meldungen = r.ok ? r.data.meldungen : [];
    // Vorbelegung: offener Rest (Schlange „offen“) bzw. die fehlende Anzahlung. Bei einer
    // Meldung ohne Zeile in „offen“ bleibt der Rest unbekannt; bestätigt wird oben im Dialog.
    const ausOffen = zustand.art === "fertig" ? zustand.antwort.schlangen.offen.find((o) => o.dealId === z.dealId) : undefined;
    const rest = schlange === "meldung" ? (ausOffen?.betragCent ?? null) : z.betragCent;
    setOffen({ art: "zahlung", dealId: z.dealId, zahlung: zahlungFuerDialog(rest, meldungen) });
  }

  const a = zustand.art === "fertig" ? zustand.antwort : null;
  const firmen = a?.firmen ?? [];
  const schlangen = a ? schlangenAus(a) : [];
  const zweite = a
    ? schlangen.some((s) => s.zeilen.length > 0)
      ? "Was an Geld noch auf euch oder den Kunden wartet"
      : "Alles erledigt, nichts wartet"
    : "Geld, das noch offen ist";

  return (
    <div className="kasse">
      <header className="neu-kopf kasse-kopf">
        <div>
          <h1>{seitentitel("/app/kasse")}</h1>
          <p className="neu-kopf-zweite">{zweite}</p>
        </div>
        {firmen.length > 1 ? (
          <div className="kasse-firmen">
            <GlassSegmentedControl
              value={firma}
              onValueChange={(v) => setFirma(v)}
              aria-label="Firma"
            >
              <GlassSegmentedControlItem value="alle">
                Alle
              </GlassSegmentedControlItem>
              {firmen.map((f) => (
                <GlassSegmentedControlItem key={f.id} value={f.id}>
                  {f.name.trim().split(/\s+/)[0]}
                </GlassSegmentedControlItem>
              ))}
            </GlassSegmentedControl>
          </div>
        ) : null}
      </header>

      {zustand.art === "laden" ? (
        <div
          className="kasse-raster"
          aria-busy="true"
          aria-label="Kasse wird geladen"
        >
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className="lg-skeleton kasse-skelett" />
          ))}
        </div>
      ) : null}

      {zustand.art === "fehler" ? (
        <div className="kasse-hinweis" role="alert">
          <p>Kasse konnte nicht geladen werden. {zustand.meldung}</p>
          <GlassButton size="sm" onClick={() => void laden()}>
            Erneut versuchen
          </GlassButton>
        </div>
      ) : null}

      {a ? (
        <>
          <ul className="kasse-kacheln" aria-label="Summen">
            {schlangen.map((s) => (
              <li
                key={s.schlange}
                className="kasse-kachel"
                data-voll={s.summe.anzahl > 0 || undefined}
              >
                <span className="kasse-kachel-titel">{s.titel}</span>
                <b className="kasse-kachel-wert">{kachelText(s.summe)}</b>
              </li>
            ))}
          </ul>
          <div className="kasse-raster">
            {schlangen.map((s) => (
              <KasseSchlangeAnsicht
                key={s.schlange}
                schlange={s.schlange}
                titel={s.titel}
                zeilen={s.zeilen}
                summe={s.summe}
                laeuft={laeuft}
                onAktion={(z) => void aktion(s.schlange, z)}
              />
            ))}
          </div>
          <p className="kasse-fuss">
            Ausgaben, Gesellschaften und Privatbewegungen:{" "}
            <Link href={mitAlt("/financial")}>alte Finanzseite</Link>
          </p>
        </>
      ) : null}

      {offen?.art === "zahlung" ? (
        <ZahlungDialog
          dealId={offen.dealId}
          zahlung={offen.zahlung}
          portalZiel={portalZiel}
          onSchliessen={() => setOffen(null)}
          onNeuLaden={async () => {
            await neuLaden();
            // Meldungen im offenen Dialog nachziehen.
            const r = await apiAufruf<{ meldungen: Zahlungsmeldung[] }>(
              `/api/v1/deals/${offen.dealId}/payment-reports`,
            );
            if (r.ok)
              setOffen((o) =>
                o?.art === "zahlung"
                  ? {
                      ...o,
                      zahlung: { ...o.zahlung, meldungen: r.data.meldungen },
                    }
                  : o,
              );
          }}
        />
      ) : null}
      {offen?.art === "rechnung" ? (
        <RechnungFluss
          dealId={offen.dealId}
          portalZiel={portalZiel}
          onGeaendert={neuLaden}
          onEnde={() => {
            setOffen(null);
            void neuLaden();
          }}
        />
      ) : null}
    </div>
  );
}
