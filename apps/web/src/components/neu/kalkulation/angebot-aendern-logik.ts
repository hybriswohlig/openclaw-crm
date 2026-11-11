/**
 * Plan 16: reine Helfer für das Panel „Angebot ändern“ (ohne React).
 */
import type { Quelle } from "@/lib/angebot-aenderung";
import type { VergleichZeile } from "@/lib/angebot-vergleich";
import type { AenderungsAnsicht, AnsichtsVorschlag } from "@/services/angebot-aenderung";

export type AenderungsDaten = AenderungsAnsicht & { darfAnnahmeAufheben: boolean };

export const QUELLE_TEXT: Record<Quelle, string> = {
  chat: "Chat",
  eingabe: "Eingabe",
  bot: "Bot",
  foto: "Foto",
  hand: "Hand",
};

export function aenderungsUrl(dealId: string, pfad = ""): string {
  return `/api/v1/deals/${encodeURIComponent(dealId)}/angebot-aenderung${pfad}`;
}

/** Vorab angehakt: offene Vorschläge außer „nicht zuordenbar“, Foto-Dubletten und Teilen, die schon mitkommen. */
export function startAuswahl(vorschlaege: readonly AnsichtsVorschlag[]): Set<string> {
  return new Set(
    vorschlaege
      .filter((v) => v.status === "offen" && v.aenderung.art !== "unklar" && !v.foto?.dublette && !v.schonDa)
      .map((v) => v.id)
  );
}

/** Ein Vorgang läuft am Entwurf `version`. */
export function laeuftAn(d: AenderungsDaten | null, version: number): boolean {
  return !!d?.vorgang && d.vorgang.status === "entwurf" && d.vorgang.version === version;
}

/** Offene Vorschläge (für Band und Knopf). */
export function offene(d: AenderungsDaten | null): number {
  return d?.vorschlaege.filter((v) => v.status === "offen").length ?? 0;
}

/** „Angebot ändern“ an einer gesperrten Version: nur an der maßgeblichen und ohne laufenden Vorgang an ihr. */
export function aendernMoeglich(d: AenderungsDaten | null, version: { nummer: number; status: "entwurf" | "gesperrt" }): boolean {
  return !!d?.moeglich && version.status === "gesperrt" && d.basis?.version === version.nummer;
}

/** Hinweis auf Fotos, die noch laufen oder gescheitert sind; null ohne. */
export function fotoHinweis(f: { offen: number; gescheitert: number }): string | null {
  const teile: string[] = [];
  if (f.offen > 0) teile.push(f.offen === 1 ? "1 Foto wird noch ausgewertet" : `${f.offen} Fotos werden noch ausgewertet`);
  if (f.gescheitert > 0) teile.push(f.gescheitert === 1 ? "1 Foto konnte nicht ausgewertet werden" : `${f.gescheitert} Fotos konnten nicht ausgewertet werden`);
  return teile.length > 0 ? `${teile.join(", ")}.` : null;
}

/** Was vor dem Sperren der geänderten Version zu bestätigen ist. */
export function sperrPunkte(d: AenderungsDaten): { annahme: boolean; fotos: string | null; offen: number } {
  return { annahme: !!d.basis?.angenommen, fotos: fotoHinweis(d.fotos), offen: offene(d) };
}

export function zeileText(z: VergleichZeile): string {
  return z.text;
}
