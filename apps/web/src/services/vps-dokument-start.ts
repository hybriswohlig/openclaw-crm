/**
 * Foto-Laden und VPS-Start für Dokumentjobs, aus `POST /api/tools/run` gelöst.
 * Das Register schreibt der Aufrufer (beim KV in seiner eigenen Transaktion).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { inboxMessageAttachments } from "@/db/schema/inbox";
import { findDealInternalPhotosByIds } from "@/services/deal-photos";

// Obergrenze der Base64-Nutzlast an FastAPI (Länge der Base64-Strings, das geht
// auf die Leitung). 12 MB bleibt unter dem Body-Limit der VM. Lieber sichtbar
// scheitern als Fotos still weglassen.
const MAX_IMAGE_BASE64_BYTES_TOTAL = 12 * 1024 * 1024;
const MAX_IMAGES_FORWARDED = 40;

type Foto = { filename: string; mime: string; base64: string };

type Anhang = {
  id: string;
  fileName: string;
  mimeType: string;
  fileContent: string;
  dealRecordId: string | null;
};

/**
 * Lädt angeforderte Fotos aus dem Workspace (Inbox, sonst interne Deal-Fotos).
 * Dieselben Texte und Statuscodes wie bisher in der Route.
 */
export async function fotosLaden(
  ws: string,
  dealId: string | null,
  ids: string[]
): Promise<{ ok: true; images: Foto[] } | { ok: false; status: 400 | 403 | 413; error: string }> {
  if (ids.length > MAX_IMAGES_FORWARDED) {
    return {
      ok: false,
      status: 400,
      error: `Zu viele Fotos (${ids.length}). Höchstens ${MAX_IMAGES_FORWARDED} Dateien.`,
    };
  }
  if (ids.length === 0) return { ok: true, images: [] };

  const rows = await db
    .select({
      id: inboxMessageAttachments.id,
      fileName: inboxMessageAttachments.fileName,
      mimeType: inboxMessageAttachments.mimeType,
      fileContent: inboxMessageAttachments.fileContent,
      dealRecordId: inboxMessageAttachments.dealRecordId,
    })
    .from(inboxMessageAttachments)
    .where(
      and(eq(inboxMessageAttachments.workspaceId, ws), inArray(inboxMessageAttachments.id, ids))
    );

  const byId = new Map<string, Anhang>(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    const internal = await findDealInternalPhotosByIds(ws, missing, dealId ?? undefined);
    for (const photo of internal) {
      byId.set(photo.id, {
        id: photo.id,
        fileName: photo.fileName,
        mimeType: photo.mimeType,
        fileContent: photo.fileContent,
        dealRecordId: photo.dealRecordId,
      });
    }
  }

  const images: Foto[] = [];
  let totalBase64Bytes = 0;
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) {
      return { ok: false, status: 403, error: `Foto ${id} gehört nicht zu diesem Workspace.` };
    }
    if (dealId && r.dealRecordId && r.dealRecordId !== dealId) {
      return { ok: false, status: 403, error: `Foto ${r.fileName} gehört nicht zu diesem Auftrag.` };
    }
    if (!r.mimeType.startsWith("image/")) continue;
    const base64Len = r.fileContent.length;
    if (totalBase64Bytes + base64Len > MAX_IMAGE_BASE64_BYTES_TOTAL) {
      return {
        ok: false,
        status: 413,
        error:
          "Die ausgewählten Fotos sind zu groß für den Dokumentjob. Bitte kleinere Dateien wählen. Es werden keine Dokumente ohne die angeforderten Fotos erzeugt.",
      };
    }
    totalBase64Bytes += base64Len;
    images.push({ filename: r.fileName, mime: r.mimeType, base64: r.fileContent });
  }
  if (images.length !== ids.filter((id) => byId.get(id)?.mimeType.startsWith("image/")).length) {
    return { ok: false, status: 400, error: "Nicht alle angeforderten Fotos konnten geladen werden." };
  }
  return { ok: true, images };
}

/**
 * Startet nur den VPS-Job; das Register schreibt der Aufrufer (bei KV in seiner Transaktion).
 * Netzfehler wirft der Aufruf weiter (die Route verwirft dann die Rechnung).
 */
export async function vpsJobStarten(
  e: { ws: string; userId: string; skill: string; params: Record<string, unknown>; timeoutSec?: number },
  abruf: typeof fetch = fetch
): Promise<{ ok: true; jobId: string; data: unknown } | { ok: false; status: number; data: unknown }> {
  const url = process.env.CRM_TOOLS_API_URL;
  const token = process.env.CRM_TOOLS_AUTH_TOKEN;
  if (!url || !token) throw new Error("crm-tools env not configured");

  const res = await abruf(`${url}/skills/${encodeURIComponent(e.skill)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      params: {
        ...e.params,
        _workspace_id: e.ws,
        _user_id: e.userId,
      },
      timeout_sec: e.timeoutSec,
    }),
  });

  const data = await res.json().catch(() => ({}));
  const jobId = (data as { job_id?: unknown }).job_id;
  if (res.ok && typeof jobId === "string") return { ok: true, jobId, data };
  return { ok: false, status: res.status, data };
}
