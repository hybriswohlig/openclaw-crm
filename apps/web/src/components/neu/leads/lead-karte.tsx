"use client";

import { useDraggable } from "@dnd-kit/core";
import Link from "next/link";
import type { ReactNode } from "react";
import { spaltenTon, type LeadKarte as Karte } from "@/lib/leads-board";

/**
 * Füllungen der Team-Kürzel nach Reihenfolge: dunkle Tinten, auf denen weiße
 * Schrift 4,5:1 erreicht (wie der Kopf der Akte); kein Vermilion, kein Gold.
 */
const KUERZEL_FARBEN = ["var(--ink)", "var(--jade-ink)", "var(--blue-ink)", "var(--violet)", "var(--gold-ink)"] as const;

/** Pfad der Akte. */
export function akteUrl(dealId: string): string {
  return `/app/leads/${encodeURIComponent(dealId)}`;
}

/**
 * Der Inhalt einer Karte (Mockup 03, Entscheidungen 10 bis 13): Name und
 * Betrag, „Art · Strecke · Datum“, Warte-Pille, goldene Zeile einer
 * offenen Zahlungsmeldung, Fußzeile mit Quelle (bei Geplant das Team), einem
 * Kontextfeld, Firmenpunkt und Aktivität. `stufePille` am Handy, `menue` am
 * Desktop (Weg ohne Ziehen).
 */
export function KarteInhalt({
  karte,
  stufePille = false,
  menue,
  klickErlaubt,
  onZahlungGemeldet,
}: {
  karte: Karte;
  stufePille?: boolean;
  menue?: ReactNode;
  /** Nach einem Zug feuert der Browser noch einen Klick; der darf die Akte nicht öffnen. */
  klickErlaubt?: () => boolean;
  onZahlungGemeldet?: (karte: Karte) => void;
}) {
  const geplant = karte.stufe.kategorie === "booked";
  // Der Server meldet offene Zahlungsmeldungen auf jeder Karte; bei Bezahlt gibt es nichts mehr zu bestätigen.
  const gemeldet = karte.stufe.kategorie === "paid" ? null : karte.zahlungGemeldet;
  return (
    <>
      <div className="leads-karte-kopf">
        <Link
          href={akteUrl(karte.id)}
          className="leads-karte-name"
          draggable={false}
          onClick={(e) => {
            if (klickErlaubt && !klickErlaubt()) e.preventDefault();
          }}
        >
          {karte.name}
        </Link>
        <span className="leads-karte-betrag" data-art={karte.betrag?.art ?? "ohne"}>
          {karte.betragText}
        </span>
      </div>
      {stufePille ? (
        <span className="leads-stufe-pille">
          <i className="leads-punkt" data-ton={spaltenTon(karte.stufe.kategorie)} aria-hidden="true" />
          {karte.stufe.label}
        </span>
      ) : null}
      {karte.was ? (
        <p className="leads-karte-was" title={karte.was}>
          {karte.was}
        </p>
      ) : null}
      {karte.wartet.text ? (
        <span className="leads-wartet" data-ton={karte.wartet.ton ?? undefined} title={karte.wartet.text}>
          <i aria-hidden="true" />
          {karte.wartet.text}
        </span>
      ) : null}
      {gemeldet ? (
        onZahlungGemeldet ? (
          <button
            type="button"
            className="leads-gemeldet"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onZahlungGemeldet(karte);
            }}
          >
            {gemeldet}
          </button>
        ) : (
          <span className="leads-gemeldet">{gemeldet}</span>
        )
      ) : null}
      <div className="leads-karte-fuss">
        {geplant ? (
          <span className="leads-team" aria-label={teamLabel(karte)}>
            {karte.team.map((m, i) => (
              <span key={`${m.name}-${i}`} className="leads-avatar" style={{ background: KUERZEL_FARBEN[i % KUERZEL_FARBEN.length] }} title={m.name}>
                {m.kuerzel}
              </span>
            ))}
            {karte.teamFehlt ? (
              <span className="leads-avatar leads-avatar-fehlt" title="Team unvollständig">
                ?
              </span>
            ) : null}
          </span>
        ) : karte.quelle ? (
          <span className="leads-quelle">{karte.quelle.label}</span>
        ) : null}
        {karte.kontext ? <span className="leads-kontext">{karte.kontext}</span> : null}
        <span className="leads-fuss-rest" />
        {karte.firma ? <i className="leads-firma" style={{ background: karte.firma.farbe }} title={karte.firma.name} aria-label={karte.firma.name} /> : null}
        {karte.aktivitaetText ? <span className="leads-aktivitaet">{karte.aktivitaetText}</span> : null}
        {menue}
      </div>
    </>
  );
}

function teamLabel(k: Karte): string {
  if (k.team.length === 0) return k.teamFehlt ? "Team fehlt" : "Kein Team";
  const namen = k.team.map((m) => m.name).join(", ");
  return k.teamFehlt ? `Team: ${namen}, unvollständig` : `Team: ${namen}`;
}

/**
 * Eine Karte im Board: ziehbar (Zeiger, Abstand 5), Klick öffnet die Akte.
 * `unterwegs`: die Karte liegt gerade als Überlagerung im Ziel und wartet auf
 * die Entscheidung; sie bleibt blass an ihrem Platz, bis der Zug entschieden ist.
 */
export function LeadKarte({
  karte,
  unterwegs,
  menue,
  klickErlaubt,
  onOeffnen,
  onZahlungGemeldet,
}: {
  karte: Karte;
  unterwegs: boolean;
  menue?: ReactNode;
  klickErlaubt: () => boolean;
  onOeffnen: (karte: Karte) => void;
  onZahlungGemeldet: (karte: Karte) => void;
}) {
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: karte.id, data: { karte }, disabled: unterwegs });
  return (
    <article
      ref={setNodeRef}
      className="leads-karte"
      data-ziehend={isDragging || undefined}
      data-unterwegs={unterwegs || undefined}
      {...listeners}
      onClick={(e) => {
        // Link und Knöpfe in der Karte öffnen selbst oder gar nichts.
        if ((e.target as HTMLElement).closest("a, button")) return;
        if (!klickErlaubt()) return;
        onOeffnen(karte);
      }}
    >
      <KarteInhalt karte={karte} menue={menue} klickErlaubt={klickErlaubt} onZahlungGemeldet={onZahlungGemeldet} />
    </article>
  );
}
