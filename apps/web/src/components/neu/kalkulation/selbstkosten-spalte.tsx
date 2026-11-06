"use client";

import "@/styles/neu-kalk-kosten.css";

import { useState } from "react";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import type { AnpassungAnsicht, GrundlageFeld, KalkulationsAnsicht, SelbstkostenAnsicht, SelbstkostenGruppe } from "@/lib/kalkulations-ansicht";
import { euro } from "@/components/neu/akte/format";
import { AnpassungDialog, type AnpassungStart } from "./anpassung-dialog";
import type { KalkKontext } from "./kalk-seite";
import { KostenGruppeZeile, KostenUnterzeile, postenKeyFuer, unterzeileUebersteuerbar } from "./kostenzeile";
import { MaterialChip, ZeitpostenChips } from "./zeitposten-chips";

/** Übersteuerbare Kostenzeilen (Gruppen und echte Unterzeilen) für die Auswahl im Dialog. */
export function uebersteuerbareZeilen(s: SelbstkostenAnsicht): { key: string; label: string }[] {
  const liste: { key: string; label: string }[] = [];
  for (const g of s.gruppen) {
    liste.push({ key: postenKeyFuer(g), label: g.label });
    for (const u of g.unterzeilen) if (unterzeileUebersteuerbar(u)) liste.push({ key: u.key, label: `${g.label} · ${u.label}` });
  }
  return liste;
}

/**
 * Mittlere Spalte „Selbstkosten“ (Spec 3.6): Gruppen mit Formel, Unterzeilen
 * eingerückt, Zeitposten-Chips unter Arbeit, Materialposten unter Material,
 * Zwischensumme, Gemeinkosten und Risiko, Versicherung, Selbstkosten. Klick
 * auf eine Zeile öffnet den Anpassungs-Dialog.
 */
export function SelbstkostenSpalte({
  selbstkosten,
  vorlagen,
  anpassungen,
  felder,
  kontext,
}: {
  selbstkosten: SelbstkostenAnsicht;
  vorlagen: KalkulationsAnsicht["zeitpostenVorlagen"];
  anpassungen: AnpassungAnsicht[];
  felder: GrundlageFeld[];
  kontext: KalkKontext;
}) {
  const [dialog, setDialog] = useState<AnpassungStart | null>(null);
  const portalZiel = usePortalZiel();
  const beschaeftigt = kontext.laeuft !== null;
  const zeilen = uebersteuerbareZeilen(selbstkosten);
  const hatMaterial = selbstkosten.gruppen.some((g) => g.key === "material");

  const gruppeKlick = (g: SelbstkostenGruppe) =>
    setDialog({ art: "zeile", key: postenKeyFuer(g), label: g.label, aktuell: `${euro(g.betragCent)}${g.formel ? ` (${g.formel})` : ""}` });

  return (
    <GlassPanel variant="panel" className="kalk-panel" aria-label="Selbstkosten">
      <div className="kalk-panel-kopf">
        <div>
          <h2 className="kalk-panel-titel">Selbstkosten</h2>
          <p className="kalk-panel-unter">Was uns der Auftrag kostet, Zeile für Zeile.</p>
        </div>
        {selbstkosten.tarifText ? <span className="kalk-panel-rechts">{selbstkosten.tarifText}</span> : null}
      </div>

      {selbstkosten.gruppen.length === 0 ? (
        <p className="kalk-kette-leer">Noch keine Kostenzeilen. Sobald der Rechner geantwortet hat, steht hier die Kette.</p>
      ) : (
        <div className="kalk-kette">
          {selbstkosten.gruppen.map((g) => (
            <div key={g.key} role="group" aria-label={g.label}>
              <KostenGruppeZeile gruppe={g} beschaeftigt={beschaeftigt} onKlick={gruppeKlick} />
              {g.unterzeilen.map((u) => (
                <KostenUnterzeile
                  key={u.key}
                  zeile={u}
                  beschaeftigt={beschaeftigt}
                  onKlick={
                    u.key.startsWith("zeitposten.")
                      ? () => setDialog({ art: "zeitposten", key: u.key.slice("zeitposten.".length), bezeichnung: u.label.split(" · ")[0] })
                      : unterzeileUebersteuerbar(u)
                        ? () => setDialog({ art: "zeile", key: u.key, label: `${g.label} · ${u.label}`, aktuell: u.wert })
                        : undefined
                  }
                />
              ))}
              {g.key === "arbeit" || g.key === "personal.arbeit" ? (
                <ZeitpostenChips
                  vorlagen={vorlagen}
                  beschaeftigt={beschaeftigt}
                  onVorlage={(v) => setDialog({ art: "zeitposten", bezeichnung: v.bezeichnung, minuten: v.minuten })}
                  onEigener={() => setDialog({ art: "zeitposten" })}
                />
              ) : null}
              {g.key === "material" ? <MaterialChip beschaeftigt={beschaeftigt} onKlick={() => setDialog({ art: "material_frei" })} /> : null}
            </div>
          ))}
          {!hatMaterial ? <MaterialChip beschaeftigt={beschaeftigt} onKlick={() => setDialog({ art: "material_frei" })} /> : null}

          <div className="kalk-summe">
            <span>Zwischensumme</span>
            <span>{euro(selbstkosten.zwischensummeCent)}</span>
          </div>
          {selbstkosten.gemeinkosten ? (
            <div className="kalk-ku">
              <span>Gemeinkosten und Risiko {selbstkosten.gemeinkosten.prozent} % · Büro, Ausfall, Schäden</span>
              <span className="kalk-ku-a">{euro(selbstkosten.gemeinkosten.betragCent)}</span>
            </div>
          ) : null}
          {selbstkosten.versicherungCent !== null ? (
            <div className="kalk-ku">
              <span>Transportversicherung pauschal</span>
              <span className="kalk-ku-a">{euro(selbstkosten.versicherungCent)}</span>
            </div>
          ) : null}
          <div className="kalk-summe" data-gross="">
            <span>Selbstkosten</span>
            <span>{euro(selbstkosten.selbstkostenCent)}</span>
          </div>
          <p className="kalk-kette-hinweis">
            Jede Zeile lässt sich überschreiben. Überschriebene Zeilen bleiben gold markiert und tragen Name, Zeit und Grund.
          </p>
        </div>
      )}

      {dialog ? (
        <AnpassungDialog
          start={dialog}
          zeilen={zeilen}
          felder={felder}
          anpassungen={anpassungen}
          kontext={kontext}
          portalZiel={portalZiel}
          onSchliessen={() => setDialog(null)}
        />
      ) : null}
    </GlassPanel>
  );
}
