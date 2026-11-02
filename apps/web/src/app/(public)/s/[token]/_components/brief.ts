import { kundenText, type FirmaBranding, type ServiceArt } from "@openclaw-crm/customer-portal-core";

/** Das Festangebot als Brief: reine Texte und Daten, ohne React. */
export type BriefZustand = "offen" | "abgelaufen" | "termin_vorbei" | "angenommen" | "unterschrieben";

export function briefZustand(i: {
  angenommen: boolean;
  unterschrieben: boolean;
  abgelaufen: boolean;
  /** Termin vor heute, nie angenommen: Annahme gesperrt (termin_vorbei). */
  terminVorbei?: boolean;
}): BriefZustand {
  if (i.unterschrieben) return "unterschrieben";
  if (i.angenommen) return "angenommen";
  if (i.terminVorbei) return "termin_vorbei";
  return i.abgelaufen ? "abgelaufen" : "offen";
}

/** Hinweis statt Annahme-Knopf, wenn der Termin vorbei ist. */
export const TERMIN_VORBEI_HINWEIS =
  "Der Termin aus diesem Angebot ist schon vorbei. Möchten Sie einen neuen Termin, schreiben Sie uns kurz, dann schicken wir Ihnen ein neues Angebot.";

export function terminVorbeiHinweis(firma: string | null | undefined): string {
  return kundenText(
    firma,
    TERMIN_VORBEI_HINWEIS,
    "Der Termin aus diesem Angebot ist schon vorbei. Möchtest du einen neuen Termin, schreib uns kurz, dann schicken wir dir ein neues Angebot.",
  );
}

/** Vorausgefüllte WhatsApp-Nachricht zum vergangenen Termin. */
export function terminVorbeiNachricht(firma: string, dealNumber: string): string {
  return `Guten Tag ${firma}, der Termin im Angebot zu meinem Auftrag ${dealNumber} ist schon vorbei. Können wir einen neuen Termin finden?`;
}

export function briefAnrede(name: string | null): string {
  const n = name?.trim();
  return n ? `Guten Tag ${n},` : "Guten Tag,";
}

const LEISTUNG: Record<ServiceArt, string> = {
  move: "den Umzug",
  kitchen_installation: "die Küchenmontage",
  clearance: "die Entrümpelung",
};

export function briefEinleitung(
  z: BriefZustand,
  moveDateLabel: string | null,
  angenommenAmLabel: string | null,
  leistung: ServiceArt | null = "move",
  firma?: string | null,
): string {
  const t = (sie: string, du: string) => kundenText(firma, sie, du);
  if (z === "abgelaufen") {
    return t(
      "dieses Angebot ist abgelaufen. Schreiben Sie uns kurz, dann schicken wir Ihnen ein aktuelles.",
      "dieses Angebot ist abgelaufen. Schreib uns kurz, dann schicken wir dir ein aktuelles.",
    );
  }
  if (z === "termin_vorbei") {
    return t(
      "der Termin aus diesem Angebot ist schon vorbei. Möchten Sie einen neuen Termin, schreiben Sie uns kurz, dann schicken wir Ihnen ein neues Angebot.",
      "der Termin aus diesem Angebot ist schon vorbei. Möchtest du einen neuen Termin, schreib uns kurz, dann schicken wir dir ein neues Angebot.",
    );
  }
  if (z === "offen") {
    const termin = moveDateLabel ? ` am ${moveDateLabel}` : "";
    const wofuer = leistung ? LEISTUNG[leistung] : t("Ihren Auftrag", "deinen Auftrag");
    return t(
      `hier ist Ihr Festpreis für ${wofuer}${termin}. Wenn alles passt, nehmen Sie das Angebot unten an.`,
      `hier ist dein Festpreis für ${wofuer}${termin}. Wenn alles passt, nimm das Angebot unten an.`,
    );
  }
  const wann = angenommenAmLabel ? ` am ${angenommenAmLabel}` : "";
  const dank = t(
    `vielen Dank, Sie haben das Angebot${wann} angenommen. Die Auftragsbestätigung folgt nach unserer Einsatzplanung.`,
    `vielen Dank, du hast das Angebot${wann} angenommen. Die Auftragsbestätigung folgt nach unserer Einsatzplanung.`,
  );
  return z === "unterschrieben"
    ? `${dank} ${t("Ihren unterschriebenen Vertrag finden Sie unten.", "Deinen unterschriebenen Vertrag findest du unten.")}`
    : dank;
}

export function grussZeilen(b: FirmaBranding): { gruss: string; name: string | null; rolle: string | null } {
  const a = b.ansprechpartner;
  return a
    ? { gruss: "Herzliche Grüße", name: a.name, rolle: a.rolle }
    : {
        gruss: "Herzliche Grüße",
        name: kundenText(b.firmaSlug, `Ihr Team von ${b.displayName}`, `Dein Team von ${b.displayName}`),
        rolle: null,
      };
}

export type Stempel = { art: "angenommen" | "unterschrieben"; datum: string };

const stempelDatum = (iso: string) =>
  new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });

export function stempel(i: { signedAt: string | null; unterschriftAt: string | null }): Stempel[] {
  const out: Stempel[] = [];
  if (i.signedAt) out.push({ art: "angenommen", datum: stempelDatum(i.signedAt) });
  if (i.signedAt && i.unterschriftAt) out.push({ art: "unterschrieben", datum: stempelDatum(i.unterschriftAt) });
  return out;
}

export function strecke(
  from: string | null,
  to: string | null,
): { zeilen: { label: "Von" | "Nach"; adresse: string }[]; mitLinie: boolean } | null {
  const zeilen: { label: "Von" | "Nach"; adresse: string }[] = [];
  if (from?.trim()) zeilen.push({ label: "Von", adresse: from.trim() });
  if (to?.trim()) zeilen.push({ label: "Nach", adresse: to.trim() });
  return zeilen.length ? { zeilen, mitLinie: zeilen.length === 2 } : null;
}

export type VorgangsSchritt = { titel: string; zustand: "erledigt" | "aktuell" | "offen"; datum: string | null };

/** Die Zeile mit den vier Schritten im Briefkopf; das Annahmedatum steht bei „Annahme“. */
export function vorgangsSchritte(i: { titel: readonly string[]; aktuellIndex: number; angenommenAm: string | null }): VorgangsSchritt[] {
  return i.titel.map((titel, n) => ({
    titel,
    zustand: n < i.aktuellIndex ? "erledigt" : n === i.aktuellIndex ? "aktuell" : "offen",
    datum: titel === "Annahme" ? i.angenommenAm : null,
  }));
}
