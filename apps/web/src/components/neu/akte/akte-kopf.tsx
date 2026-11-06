"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import { GlassSwitch } from "@/components/glassyui/glass-switch";
import type { AkteDaten } from "@/lib/akte";
import { apiAufruf, jsonAufruf } from "./api";
import { StufenMenue } from "./stufen-menue";

type Nachfass = AkteDaten["nachfass"];

/**
 * Füllungen der Kürzel, nach Reihenfolge im Team: dunkle Tinten, auf denen
 * weiße Schrift mindestens 4,5:1 erreicht; kein Vermilion (Orange ist Artwork).
 */
const KUERZEL_FARBEN = ["var(--ink)", "var(--jade-ink)", "var(--blue-ink)", "var(--violet)", "var(--gold-ink)"] as const;

/** „Umzug, 3 Zimmer, Stuttgart-West nach Esslingen.“ */
export function zweiteZeile(art: string, strecke: string): string {
  const teile = [art, strecke].filter((t) => t.trim() !== "");
  return teile.length > 0 ? `${teile.join(", ")}.` : "";
}

/**
 * Kopf der Akte: Name, zweite Zeile, Meta; rechts Team-Kürzel mit „+“ zur
 * alten Seite (Entscheidung 3), der Nachfass-Schalter (Entscheidung 8) und die
 * Stufen-Pille als Menü (Entscheidung 14).
 */
export function AkteKopf({
  dealId,
  kopf,
  nachfass,
  altLink,
  onNachfass,
  onNeuLaden,
}: {
  dealId: string;
  kopf: AkteDaten["kopf"];
  nachfass: Nachfass;
  altLink: string;
  onNachfass: (neu: Nachfass) => void;
  onNeuLaden: () => Promise<void> | void;
}) {
  const zweite = zweiteZeile(kopf.art, kopf.strecke);

  return (
    <header className="akte-kopf">
      <div className="akte-kopf-text">
        <h1 className="akte-name">{kopf.name}</h1>
        {zweite ? <p className="akte-kopf-zweite">{zweite}</p> : null}
        {kopf.meta ? <p className="akte-meta">{kopf.meta}</p> : null}
      </div>
      <div className="akte-kopf-rechts">
        <div className="akte-team" aria-label="Team">
          {kopf.team.map((m, i) => (
            <span
              key={`${m.name}-${i}`}
              className="akte-avatar"
              style={{ background: KUERZEL_FARBEN[i % KUERZEL_FARBEN.length] }}
              title={m.name}
              aria-label={m.name}
            >
              {m.kuerzel || "?"}
            </span>
          ))}
          <Link href={altLink} className="akte-avatar akte-avatar-plus" title="Team zuweisen (alte Oberfläche)">
            <span aria-hidden="true">+</span>
            <span className="sr-only">Team zuweisen, öffnet die alte Oberfläche</span>
          </Link>
        </div>
        <NachfassSchalter dealId={dealId} nachfass={nachfass} onNachfass={onNachfass} onNeuLaden={onNeuLaden} />
        <StufenMenue
          dealId={dealId}
          stufe={kopf.stufe}
          stufen={kopf.stufen}
          verlustGruende={kopf.verlustGruende}
          verlustGrund={kopf.verlustGrund}
          onGewechselt={onNeuLaden}
        />
      </div>
    </header>
  );
}

/**
 * „Nachfass automatisch“ mit dem Modus-Text darunter. PUT `/nachfass`; ist die
 * Sequenz beendet, antwortet der Server 409 BEENDET, die Meldung erscheint und
 * die Akte lädt neu.
 */
export function NachfassSchalter({
  dealId,
  nachfass,
  onNachfass,
  onNeuLaden,
}: {
  dealId: string;
  nachfass: Nachfass;
  onNachfass: (neu: Nachfass) => void;
  onNeuLaden: () => Promise<void> | void;
}) {
  const labelId = useId();
  const [speichert, setSpeichert] = useState(false);
  const [gewuenscht, setGewuenscht] = useState<boolean | null>(null);

  async function schalten(an: boolean) {
    setGewuenscht(an);
    setSpeichert(true);
    const r = await apiAufruf<Nachfass>(`/api/v1/deals/${dealId}/nachfass`, jsonAufruf("PUT", { an }));
    setSpeichert(false);
    setGewuenscht(null);
    if (r.ok) {
      onNachfass({ an: r.data.an, modus: r.data.modus, text: r.data.text });
      return;
    }
    if (r.status === 409 && r.code === "BEENDET") {
      toast.error(r.message);
      await onNeuLaden();
      return;
    }
    toast.error("Nachfass konnte nicht umgestellt werden.", { description: r.message });
  }

  return (
    <div className="akte-nachfass" data-speichert={speichert || undefined}>
      <GlassSwitch
        checked={gewuenscht ?? nachfass.an}
        onCheckedChange={(an) => void schalten(an)}
        disabled={speichert}
        aria-labelledby={labelId}
        size="sm"
      />
      <span id={labelId} className="akte-nachfass-label">
        Nachfass automatisch
      </span>
      <span className="akte-nachfass-modus">{nachfass.text}</span>
    </div>
  );
}
