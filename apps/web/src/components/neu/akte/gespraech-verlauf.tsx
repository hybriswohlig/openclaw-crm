"use client";

import { useEffect, useMemo, useRef } from "react";
import { uhrzeitKurz } from "@/lib/anzeige";
import type { GespraechEintrag, GespraechKanalArt } from "@/lib/gespraech";
import type { GespraechKanal } from "@/services/gespraech";
import { anhangUrl, istBild, type Foto } from "./fotos-ansicht";
import { nachTagen } from "./verlauf-gruppen";

type Nachricht = Extract<GespraechEintrag, { art: "nachricht" }>;
type Anruf = Extract<GespraechEintrag, { art: "anruf" }>;
type Systemzeile = Extract<GespraechEintrag, { art: "system" }>;

export const KANAL_LABEL: Record<GespraechKanalArt, string> = {
  whatsapp: "WhatsApp",
  email: "E-Mail",
  sms: "SMS",
};

/** Höchstens so viele Bilder im Streifen; der Rest als „+N“. */
const STREIFEN_MAX = 5;

/** Zustellhaken einer ausgehenden Nachricht nach `inbox_messages.status`. */
export function hakenAus(status: string): { text: string; titel: string } | null {
  switch (status) {
    case "pending":
      return { text: "…", titel: "wird gesendet" };
    case "sent":
      return { text: "✓", titel: "gesendet" };
    case "delivered":
      return { text: "✓✓", titel: "zugestellt" };
    case "read":
      return { text: "✓✓", titel: "gelesen" };
    case "failed":
      return { text: "nicht zugestellt", titel: "nicht zugestellt" };
    default:
      return null;
  }
}

/** „4 Min“ aus Sekunden; unter einer Minute „1 Min“. */
export function anrufDauer(sek: number): string {
  return `${Math.max(1, Math.round(sek / 60))} Min`;
}

/**
 * Der Verlauf: Tageskapseln, eingehende Blasen links, ausgehende rechts,
 * Systemzeilen und Anrufe mittig. Scrollt beim Laden und bei neuen Einträgen
 * ans Ende. `onFoto` öffnet ein Bild im Vollbild.
 */
export function GespraechVerlauf({
  eintraege,
  kanaele,
  onFoto,
}: {
  eintraege: GespraechEintrag[];
  kanaele: GespraechKanal[];
  onFoto: (foto: Foto) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tage = useMemo(() => nachTagen(eintraege, new Date()), [eintraege]);
  const direkt = useMemo(() => new Map(kanaele.map((k) => [k.gespraechId, k.direkt])), [kanaele]);
  const letzteId = eintraege[eintraege.length - 1]?.id ?? null;

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [letzteId]);

  if (eintraege.length === 0) {
    return (
      <div className="akte-gespraech-verlauf" ref={ref}>
        <p className="akte-gespraech-leer">Noch keine Nachrichten.</p>
      </div>
    );
  }

  return (
    <div className="akte-gespraech-verlauf" ref={ref} role="log" aria-label="Verlauf">
      {tage.map((t) => (
        <TagGruppe key={t.tag + t.eintraege[0]!.id} tag={t.tag}>
          {t.eintraege.map((e) => {
            if (e.art === "nachricht") {
              return <NachrichtBlase key={e.id} n={e} andererDeal={direkt.get(e.gespraechId) === false} onFoto={onFoto} />;
            }
            if (e.art === "anruf") return <AnrufZeile key={e.id} a={e} />;
            return <SystemZeile key={e.id} s={e} />;
          })}
        </TagGruppe>
      ))}
    </div>
  );
}

function TagGruppe({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <>
      <div className="akte-gespraech-tag">{tag}</div>
      {children}
    </>
  );
}

function NachrichtBlase({
  n,
  andererDeal,
  onFoto,
}: {
  n: Nachricht;
  andererDeal: boolean;
  onFoto: (foto: Foto) => void;
}) {
  const bilder = n.anhaenge.filter((a) => istBild(a.mime));
  const dateien = n.anhaenge.filter((a) => !istBild(a.mime));
  const eingehend = n.richtung === "inbound";
  const haken = eingehend ? null : hakenAus(n.status);
  const rest = bilder.length - STREIFEN_MAX;

  return (
    <article className="akte-gespraech-nachricht" data-richtung={eingehend ? "ein" : "aus"}>
      {n.text.trim() !== "" ? <p className="akte-gespraech-text">{n.text}</p> : null}
      {bilder.length > 0 ? (
        <div className="akte-gespraech-fotos">
          {bilder.slice(0, STREIFEN_MAX).map((b, i) => (
            <button
              key={b.id}
              type="button"
              className="akte-gespraech-foto"
              onClick={() => onFoto({ id: b.id, name: b.name, am: n.zeit })}
              aria-label={`Foto ${i + 1} von ${bilder.length} öffnen`}
            >
              <img src={anhangUrl(b.id)} alt="" loading="lazy" />
            </button>
          ))}
          {rest > 0 ? (
            <button
              type="button"
              className="akte-gespraech-foto"
              onClick={() => onFoto({ id: bilder[STREIFEN_MAX]!.id, name: bilder[STREIFEN_MAX]!.name, am: n.zeit })}
              aria-label={`${rest} weitere Fotos öffnen`}
            >
              +{rest}
            </button>
          ) : null}
        </div>
      ) : null}
      {dateien.length > 0 ? (
        <ul className="akte-gespraech-dateien">
          {dateien.map((d) => (
            <li key={d.id}>
              <a className="akte-gespraech-datei" href={anhangUrl(d.id)} target="_blank" rel="noreferrer">
                {d.name}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="akte-gespraech-meta">
        <span className="akte-gespraech-kanal">
          <i className="akte-gespraech-punkt" data-kanal={n.kanal} aria-hidden="true" />
          {KANAL_LABEL[n.kanal]}
        </span>
        <span>· {uhrzeitKurz(n.zeit)}</span>
        {eingehend && n.von ? <span>· {n.von}</span> : null}
        {haken ? (
          <span>
            ·{" "}
            <span className="akte-gespraech-haken" data-status={n.status} title={haken.titel} aria-label={haken.titel}>
              {haken.text}
            </span>
          </span>
        ) : null}
        {bilder.length > 0 ? <span>· {bilder.length === 1 ? "1 Foto" : `${bilder.length} Fotos`}</span> : null}
        {andererDeal ? (
          <span>
            · <span className="akte-gespraech-marke">anderer Deal</span>
          </span>
        ) : null}
      </div>
    </article>
  );
}

function AnrufZeile({ a }: { a: Anruf }) {
  return (
    <div className="akte-gespraech-system">
      <span className="akte-gespraech-system-zeile">
        <i className="akte-gespraech-punkt" data-kanal="anruf" aria-hidden="true" />
        <b>Anruf</b>
        {a.dauerSek !== null && a.dauerSek > 0 ? <span>· {anrufDauer(a.dauerSek)}</span> : null}
        <span>· {uhrzeitKurz(a.zeit)}</span>
      </span>
      {a.zusammenfassung ? <span className="akte-gespraech-anruf-text">{a.zusammenfassung}</span> : null}
    </div>
  );
}

/** `betont` steht wörtlich am Ende von `text` und wird dort fett gesetzt, nicht angehängt. */
function SystemZeile({ s }: { s: Systemzeile }) {
  const fett = s.betont && s.text.endsWith(s.betont) ? s.betont : null;
  const vorn = fett ? s.text.slice(0, s.text.length - fett.length) : s.text;
  return (
    <div className="akte-gespraech-system">
      <span>
        {vorn}
        {fett ? <b>{fett}</b> : null}
      </span>
    </div>
  );
}
