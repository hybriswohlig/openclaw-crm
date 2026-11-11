/**
 * Netz-Teil von „Statuslink kopieren“ (Auftrag kv-danach): Link des Deals
 * lesen, fehlt er, über den bestehenden Weg anlegen (`POST /customer-link`,
 * idempotent, beachtet „Portal aus“). Ein gesperrter Link bleibt gesperrt.
 */
import { apiAufruf } from "@/components/neu/akte/api";
import { statusLinkAusGet, statusLinkAusPost, type LinkGet, type LinkPost, type StatusLink } from "@/lib/kv-danach";

export async function statusLinkHolen(dealId: string): Promise<StatusLink> {
  const url = `/api/v1/customer-link/${encodeURIComponent(dealId)}`;
  const gelesen = statusLinkAusGet(await apiAufruf<LinkGet | null>(url));
  if (gelesen !== "anlegen") return gelesen;
  return statusLinkAusPost(await apiAufruf<LinkPost | null>(url, { method: "POST" }));
}

/**
 * Text in die Zwischenablage, auch wenn er erst nach einem Netzaufruf feststeht:
 * `ClipboardItem` mit Promise hält die Nutzergeste (Safari), sonst `writeText`.
 * Ein `null`-Text wird nicht kopiert. Liefert, ob kopiert wurde.
 */
export async function textKopieren(text: Promise<string | null>): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  if (typeof ClipboardItem !== "undefined" && typeof navigator.clipboard.write === "function") {
    const blob = text.then((t) => {
      if (!t) throw new Error("kein Text");
      return new Blob([t], { type: "text/plain" });
    });
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      return true;
    } catch {
      // Weiter mit writeText (ältere Browser, oder es gab nichts zu kopieren).
    }
  }
  const t = await text.catch(() => null);
  if (!t) return false;
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false;
  }
}
