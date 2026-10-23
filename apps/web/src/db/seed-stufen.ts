import { stufenKategorie } from "../services/lagekarte/status";

/**
 * Seed-Stufen, die im Workspace noch fehlen. Eine Stufe gilt als vorhanden,
 * wenn es schon eine mit gleichem Titel oder gleicher Bedeutung (Kategorie)
 * gibt. Sonst legt jeder Sync-Lauf neben „Geplant“ wieder ein „Planned“ an.
 */
export function fehlendeSeedStufen<T extends { title: string }>(
  vorhandene: { title: string; stageCategory: string | null }[],
  seed: readonly T[],
): T[] {
  const titel = new Set(vorhandene.map((s) => s.title.trim().toLowerCase()));
  const kategorien = new Set(
    vorhandene.map((s) => stufenKategorie({ titel: s.title, kategorie: s.stageCategory })).filter(Boolean),
  );
  return seed.filter((stufe) => {
    if (titel.has(stufe.title.trim().toLowerCase())) return false;
    const kategorie = stufenKategorie({ titel: stufe.title, kategorie: null });
    return !(kategorie && kategorien.has(kategorie));
  });
}
