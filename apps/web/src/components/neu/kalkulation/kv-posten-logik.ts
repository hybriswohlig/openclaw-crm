/**
 * Plan 15, Bauteil 6: „×“ an einem Hebel-Posten im KV setzt die zugehörige
 * Eingabe aus. Rein, ohne React. Kein fester Kundenpreis ohne Marge: der Rechner
 * rechnet danach neu.
 */
import type { HebelArt } from "@/services/rechner/kv-posten";
import type { UebersteuerungEingabe } from "./kalk-seite";

export const HEBEL_AUS_TEXT: Record<HebelArt, string> = {
  halteverbot: "Halteverbot beim Beladen und Entladen: nein",
  montage: "Montage: keine",
  einpacken: "Einpackservice: aus",
  kueche: "Küche: aus",
};

/** Übersteuerungen, die den Hebel ausschalten (je Eingabe eine, gleicher Grund). */
export function hebelAusUebersteuerungen(hebel: HebelArt, grund: string): UebersteuerungEingabe[] {
  switch (hebel) {
    case "halteverbot":
      return [
        { art: "eingabe", key: "halteverbot.beladen", wert: false, grund },
        { art: "eingabe", key: "halteverbot.entladen", wert: false, grund },
      ];
    case "montage":
      return [{ art: "eingabe", key: "hebel.montage", wert: false, grund }];
    case "einpacken":
      return [{ art: "eingabe", key: "einpacken", wert: 0, grund }];
    case "kueche":
      return [{ art: "eingabe", key: "hebel.kueche", wert: false, grund }];
  }
}
