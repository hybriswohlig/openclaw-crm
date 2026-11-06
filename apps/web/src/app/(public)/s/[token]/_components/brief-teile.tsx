"use client";

import { FileText, Truck } from "lucide-react";
import { kundenText, type FirmaBranding } from "@openclaw-crm/customer-portal-core";
import { grussZeilen, type Stempel as StempelDaten } from "./brief";
import type { AdressZeile } from "./leistung-worte";

/** Anrede mit kleinem Foto des Ansprechpartners, darunter die Einleitung. */
export function BriefAnrede({ branding, anrede, einleitung }: { branding: FirmaBranding; anrede: string; einleitung: string }) {
  const foto = branding.ansprechpartner?.fotoUrl;
  return (
    <div className="portal-brief-anrede">
      {foto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="portal-brief-foto" src={foto} alt={branding.ansprechpartner?.name ?? ""} width={44} height={44} />
      )}
      <h2 className="portal-display portal-brief-titel">{anrede}</h2>
      <p className="portal-brief-text">{einleitung}</p>
    </div>
  );
}

/** Abholung und Ziel (mit Linie und LKW) oder ein einziger Einsatzort. */
export function Strecke({
  zeilen,
  zusatz,
  termin,
}: {
  zeilen: AdressZeile[];
  zusatz: (z: AdressZeile) => string | null;
  termin: { datum: string; zeit: string | null } | null;
}) {
  if (!zeilen.length && !termin) return null;
  const mitLinie = zeilen.length === 2;
  return (
    <dl className="portal-strecke" data-linie={mitLinie ? "ja" : "nein"}>
      {zeilen.map((z, i) => (
        <div key={z.key} className="portal-strecke-halt">
          <dt>{z.label}</dt>
          <dd>
            {z.adresse}
            {zusatz(z) && <span className="block">{zusatz(z)}</span>}
          </dd>
          {mitLinie && i === 0 && (
            <span className="portal-strecke-lkw" aria-hidden>
              <Truck size={15} />
            </span>
          )}
        </div>
      ))}
      {termin && (
        <div className="portal-strecke-termin">
          <dt>Am</dt>
          <dd>
            {termin.datum}
            {termin.zeit && <span className="block">{termin.zeit}</span>}
          </dd>
        </div>
      )}
    </dl>
  );
}

/** Gruß unter dem Angebot. Die Unterschrift des Ansprechpartners erscheint nur hier. */
export function BriefGruss({ branding }: { branding: FirmaBranding }) {
  const g = grussZeilen(branding);
  const unterschrift = branding.ansprechpartner?.unterschriftUrl;
  return (
    <div className="portal-brief-gruss">
      <p>{g.gruss}</p>
      {unterschrift && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="portal-brief-unterschrift" src={unterschrift} alt={`Unterschrift von ${g.name}`} height={40} />
      )}
      <p className="portal-brief-absender">{g.rolle ? `${g.name}, ${g.rolle}` : g.name}</p>
    </div>
  );
}

export function Stempel({ s }: { s: StempelDaten }) {
  return (
    <span className="portal-stempel" data-art={s.art}>
      <strong>{s.art === "angenommen" ? "Angenommen" : "Unterschrieben"}</strong>
      <span>{s.datum}</span>
    </span>
  );
}

/** Die Linie „Ihre Annahme“: offen mit Button, danach mit Stempeln. */
export function AnnahmeZeile({
  firma,
  stempel,
  vertragUrl,
  children,
}: {
  firma: string;
  stempel: StempelDaten[];
  vertragUrl: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="portal-annahme-zeile">
      <p className="portal-annahme-label">{kundenText(firma, "Ihre Annahme", "Deine Annahme")}</p>
      {stempel.length > 0 ? (
        <div className="portal-annahme-stempel">
          {stempel.map((s) => (
            <Stempel key={s.art} s={s} />
          ))}
        </div>
      ) : (
        children
      )}
      {vertragUrl && (
        <a className="portal-annahme-vertrag" href={vertragUrl} target="_blank" rel="noopener noreferrer">
          <FileText size={16} aria-hidden /> Vertrag als PDF
        </a>
      )}
    </div>
  );
}
