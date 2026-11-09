import Link from "next/link";
import type { UebersichtAntwort } from "@/lib/einstellungen-uebersicht";
import { LAGEKARTE_LINK } from "@/components/neu/heute/heute-logik";
import { euro, monatLang, vergleichText } from "./uebersicht-logik";

function Kachel({ titel, wert, zeilen, href }: { titel: string; wert: string; zeilen: (string | null)[]; href?: string }) {
  const inhalt = (
    <>
      <span className="ueb-kachel-titel">{titel}</span>
      <b className="ueb-kachel-wert">{wert}</b>
      {zeilen.filter(Boolean).map((z) => (
        <span key={z} className="ueb-kachel-zeile">
          {z}
        </span>
      ))}
    </>
  );
  return <li className="ueb-kachel">{href ? <Link href={href}>{inhalt}</Link> : <div>{inhalt}</div>}</li>;
}

/** Kachelreihe (Entscheidung 13). */
export function Kacheln({ a }: { a: UebersichtAntwort }) {
  const jetzt = a.monate[a.monate.length - 1];
  const vorher = a.monate[a.monate.length - 2];
  const ein = a.eingegangen[jetzt] ?? 0;
  // M3: gleich viele Tage vergleichen (1. bis heute gegen 1. bis zum selben Tag des Vormonats).
  const einVorher = a.vormonat.eingegangen;
  const bisTag = Number(a.vormonat.bis.slice(8, 10));
  const d = a.durchgefuehrt[jetzt] ?? { cent: 0, anzahl: 0, ohneBetrag: 0 };
  const q = a.abschluss.gesamt;
  return (
    <ul className="ueb-kacheln" aria-label="Kennzahlen">
      <Kachel
        titel={`Eingegangen im ${monatLang(jetzt)}`}
        wert={euro(ein)}
        zeilen={[vorher ? `Vormonat bis zum ${bisTag}.: ${euro(einVorher)}` : null, vergleichText(ein, einVorher) || null]}
      />
      <Kachel
        titel={`Durchgeführt im ${monatLang(jetzt)}`}
        wert={euro(d.cent)}
        zeilen={[`${d.anzahl} ${d.anzahl === 1 ? "Auftrag" : "Aufträge"}`, d.ohneBetrag > 0 ? `+${d.ohneBetrag} ohne Betrag` : null]}
      />
      <Kachel
        titel="Offener Rest"
        wert={euro(a.offen.rest.cent)}
        zeilen={[`${a.offen.rest.anzahl} ${a.offen.rest.anzahl === 1 ? "Auftrag" : "Aufträge"}`, a.offen.rest.unbekannt > 0 ? `${a.offen.rest.unbekannt} Betrag offen` : null]}
        href="/app/kasse"
      />
      <Kachel
        titel="Durchgeführt ohne Rechnung"
        wert={String(a.offen.ohneRechnung.anzahl)}
        zeilen={[a.offen.ohneRechnung.cent > 0 ? `${euro(a.offen.ohneRechnung.cent)} Auftragswert` : null]}
        href="/app/kasse"
      />
      <Kachel
        titel="Abschlussquote 12 Monate"
        wert={q.quoteProzent == null ? "–" : `${q.quoteProzent} %`}
        zeilen={[`${q.gewonnen} gewonnen, ${q.verloren} verloren`, q.offen > 0 ? `${q.offen} noch offen` : null]}
      />
      <Kachel titel="Wartet auf uns" wert={String(a.wartetAufUns)} zeilen={["alle Firmen"]} href="/app/heute" />
      <Kachel titel="Lagekarte" wert="Karte öffnen" zeilen={["Wo gerade Aufträge liegen"]} href={LAGEKARTE_LINK} />
    </ul>
  );
}
