/**
 * Verarbeitet jeden Eintrag, auch wenn ein früherer scheitert, und gibt die
 * Fehler zurück. Der Webhook meldet sie danach an Meta (500), damit Meta neu
 * zustellt; schon gespeicherte Nachrichten scheitern dann am eindeutigen
 * Schlüssel und zählen nicht doppelt.
 */
export async function alleVerarbeiten<T>(eintraege: T[], verarbeite: (eintrag: T) => Promise<void>): Promise<unknown[]> {
  const fehler: unknown[] = [];
  for (const eintrag of eintraege) {
    try {
      await verarbeite(eintrag);
    } catch (err) {
      fehler.push(err);
    }
  }
  return fehler;
}
