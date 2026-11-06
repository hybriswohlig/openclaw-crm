/** Vorgabe-Speicher für Street View auf `street_view_images`. */
import type { StreetViewSpeicher } from "@/services/street-view-cache";

let dbSpeicher: StreetViewSpeicher | null = null;

/** Vorgabe-Speicher auf `street_view_images` (lädt `@/db` erst beim Aufruf). */
export async function dbStreetViewSpeicher(): Promise<StreetViewSpeicher> {
  if (dbSpeicher) return dbSpeicher;
  const [{ db }, { streetViewImages }, { users }, { and, eq }] = await Promise.all([
    import("@/db"),
    import("@/db/schema/street-view-images"),
    import("@/db/schema/auth"),
    import("drizzle-orm"),
  ]);
  dbSpeicher = {
    async lesen(ws, schluessel) {
      const [z] = await db
        .select({
          workspaceId: streetViewImages.workspaceId,
          adresseSchluessel: streetViewImages.adresseSchluessel,
          adresse: streetViewImages.adresse,
          status: streetViewImages.status,
          blobPfad: streetViewImages.blobPfad,
          panoId: streetViewImages.panoId,
          geholtAm: streetViewImages.geholtAm,
          notiz: streetViewImages.notiz,
          notizVonName: users.name,
          notizAm: streetViewImages.notizAm,
        })
        .from(streetViewImages)
        .leftJoin(users, eq(users.id, streetViewImages.notizVon))
        .where(and(eq(streetViewImages.workspaceId, ws), eq(streetViewImages.adresseSchluessel, schluessel)))
        .limit(1);
      return z ?? null;
    },
    async schreiben(z) {
      await db
        .insert(streetViewImages)
        .values(z)
        .onConflictDoUpdate({
          target: [streetViewImages.workspaceId, streetViewImages.adresseSchluessel],
          set: { adresse: z.adresse, status: z.status, blobPfad: z.blobPfad, panoId: z.panoId, geholtAm: z.geholtAm },
        });
    },
    async notizSetzen(ws, schluessel, text, userId) {
      const zeilen = await db
        .update(streetViewImages)
        .set(text === null ? { notiz: null, notizVon: null, notizAm: null } : { notiz: text, notizVon: userId, notizAm: new Date() })
        .where(and(eq(streetViewImages.workspaceId, ws), eq(streetViewImages.adresseSchluessel, schluessel)))
        .returning({ id: streetViewImages.id });
      return zeilen.length > 0;
    },
  };
  return dbSpeicher;
}
