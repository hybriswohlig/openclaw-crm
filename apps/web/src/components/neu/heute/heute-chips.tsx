"use client";

import Link from "next/link";
import type { InboxChips } from "@/lib/inbox-neu";
import { LEADS_CHIPS, chipText, type LeadsChips } from "@/lib/leads-board";
import { leadsChipLink } from "@/lib/plan-heute";
import { INBOX_ABGESCHNITTEN_TEXT, INBOX_JETZT, INBOX_LINK, inboxChipText, inboxZahl } from "./heute-logik";

/**
 * Die Leads-Chips „Heute im Blick“ (dieselben Zahlen wie auf /app/leads,
 * ungefiltert). Auf Heute sind sie Links auf das Board mit genau diesem Chip.
 */
export function HeuteLeadsChips({ chips, kompakt }: { chips: LeadsChips | null; kompakt: boolean }) {
  return (
    <section className="heute-chips" aria-label="Heute im Blick" data-kompakt={kompakt || undefined}>
      <h2 className="heute-chips-label">Heute im Blick</h2>
      <div className="heute-chips-reihe">
        {LEADS_CHIPS.map((c) => {
          const zahl = chips ? chips[c.key] : null;
          return (
            <Link key={c.key} href={leadsChipLink(c.key)} className="heute-chip" data-null={zahl === 0 || undefined}>
              <i data-ton={c.ton} aria-hidden="true" />
              <b>{zahl ?? "…"}</b> {chipText(c.key, zahl ?? 0)}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Inbox „Jetzt“: ungelesen, warten auf uns, KI-Entwürfe, Info / Kein Lead
 * (dieselben Zahlen wie auf /app/inbox). Jeder Chip führt in die Inbox.
 */
export function HeuteInboxChips({ chips, abgeschnitten, kompakt }: { chips: InboxChips | null; abgeschnitten: boolean; kompakt: boolean }) {
  return (
    <section className="heute-chips" aria-label="Inbox jetzt" data-kompakt={kompakt || undefined}>
      <h2 className="heute-chips-label">Inbox jetzt</h2>
      <div className="heute-chips-reihe">
        {INBOX_JETZT.map((c) => {
          const zahl = chips ? chips[c.key] : null;
          return (
            <Link key={c.key} href={INBOX_LINK} className="heute-chip" data-null={zahl === 0 || undefined}>
              <i data-ton={c.ton} aria-hidden="true" />
              <b>{zahl === null ? "…" : inboxZahl(zahl, abgeschnitten)}</b> {inboxChipText(c.key, zahl ?? 0)}
            </Link>
          );
        })}
      </div>
      {abgeschnitten ? <p className="heute-chips-hinweis">{INBOX_ABGESCHNITTEN_TEXT}</p> : null}
    </section>
  );
}
