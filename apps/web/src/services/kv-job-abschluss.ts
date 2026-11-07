/**
 * Ablegen eines fertigen VPS-Dokuments an EINER Stelle (Plan 5a, Entscheidung 7).
 * Browser (`store-as-document`) und Cron (`/api/cron/render-jobs`) rufen beide
 * hierher. Doppelt abgelegt wird nie: vor dem Abruf des PDFs reserviert
 * `jobReservieren` den Job in einer Anweisung, nur einer gewinnt.
 *
 * Ablauf: Job laden → VPS-Status `/jobs/{id}` (ohne Reservierung, damit ein
 * noch laufender Job den Browser nicht zwei Minuten blockiert) → bei „done“
 * reservieren → `/jobs/{id}/result` → EINE Transaktion (`ablegenUnterSperre`):
 * Deal-Sperre, eigene Reservierung prüfen, Version unter der Sperre neu lesen,
 * `jobAblage`, Dokument anlegen oder verwerfen (F4), Job abschließen → nach dem
 * Commit Nachläufe und Fälligkeit.
 */
import { jobReservierbar, type JobAbschluss, type RenderJob } from "@/lib/angebot-wahl";
import { jobLaden, jobReservieren } from "@/services/render-jobs";
import {
  dealDokumentNachlauf,
  parseFilenameFromContentDisposition,
  validateDealDocumentUpload,
} from "@/services/deal-documents";
import { abschliessenMitAnspruch, ablegenUnterSperre } from "@/services/kv-job-ablage";
import { applyInvoiceDueDate } from "@/services/rechnung-faellig";
import { aktiveRechnung, nachRechnung } from "@/services/rechnungen";

export interface AbschlussOptionen {
  abruf?: typeof fetch;
  jetzt?: Date;
  /** Nur Rechnung: ausdrückliches Fälligkeitsdatum aus dem Aufruf. */
  faelligAm?: unknown;
  /** Wer ablegt (Browser); der Cron nimmt den Ersteller des Jobs. */
  updatedBy?: string | null;
}

/** Ergebnis samt Angaben, die `store-as-document` in seiner Antwort braucht. */
export interface AbschlussDetails {
  abschluss: JobAbschluss;
  job: RenderJob | null;
  dokument?: {
    id: string;
    documentType: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    uploadedAt: Date;
  };
  rechnungFaelligAm?: string | null;
  dueDateWarning?: string;
}

interface VpsStatus {
  status?: string;
  error?: string | null;
}

function vpsBasis() {
  const url = process.env.CRM_TOOLS_API_URL;
  const token = process.env.CRM_TOOLS_AUTH_TOKEN;
  return url && token ? { url, token } : null;
}

/** Schon abgeschlossen oder gerade von jemand anderem reserviert: Endstand melden. */
function nichtReservierbar(job: RenderJob): JobAbschluss {
  switch (job.status) {
    case "laeuft":
      return { status: "laeuft" };
    case "abgelegt":
      return { status: "schon_erledigt", dealDocumentId: job.dealDocumentId };
    case "verworfen":
      return { status: "verworfen", grund: "version_veraltet" };
    case "fehler":
      return { status: "fehler", fehler: job.fehler || "Fehler" };
  }
}

/** Endstand nach verlorener Reservierung: neu lesen, nie selbst schreiben. */
async function neuGelesen(ws: string, vpsJobId: string): Promise<AbschlussDetails> {
  const j = await jobLaden(ws, vpsJobId);
  return { abschluss: j ? nichtReservierbar(j) : { status: "laeuft" }, job: j };
}

async function fehlerAbschliessen(
  ws: string,
  job: RenderJob & { claimedAt: string },
  fehler: string
): Promise<AbschlussDetails> {
  if (!(await abschliessenMitAnspruch(ws, job.vpsJobId, job.claimedAt, { status: "fehler", fehler }))) {
    return neuGelesen(ws, job.vpsJobId);
  }
  return { abschluss: { status: "fehler", fehler }, job };
}

export async function kvJobAbschliessenDetails(
  ws: string,
  vpsJobId: string,
  opts: AbschlussOptionen = {}
): Promise<AbschlussDetails> {
  const abruf = opts.abruf ?? fetch;
  const jetzt = opts.jetzt ?? new Date();
  const vps = vpsBasis();
  if (!vps) return { abschluss: { status: "fehler", fehler: "crm-tools env not configured" }, job: null };

  const geladen = await jobLaden(ws, vpsJobId);
  if (!geladen) return { abschluss: { status: "fehler", fehler: "Job nicht im Register" }, job: null };
  if (!jobReservierbar(geladen, jetzt)) return { abschluss: nichtReservierbar(geladen), job: geladen };

  const kopf = { Authorization: `Bearer ${vps.token}` };
  const id = encodeURIComponent(vpsJobId);

  // 1) Status ohne Reservierung: ein laufender Job bleibt für alle frei.
  let statusAntwort: Response;
  try {
    statusAntwort = await abruf(`${vps.url}/jobs/${id}`, { headers: kopf, cache: "no-store" });
  } catch {
    return { abschluss: { status: "laeuft" }, job: geladen };
  }
  const vpsGone = statusAntwort.status === 404;
  if (!statusAntwort.ok && !vpsGone) return { abschluss: { status: "laeuft" }, job: geladen };
  const status: VpsStatus = vpsGone ? {} : ((await statusAntwort.json().catch(() => ({}))) as VpsStatus);
  if (!vpsGone && status.status !== "done" && status.status !== "error") {
    return { abschluss: { status: "laeuft" }, job: geladen };
  }

  // 2) Reservieren: ab hier arbeitet genau ein Aufrufer weiter.
  const reserviert = await jobReservieren(ws, vpsJobId, jetzt);
  if (!reserviert || reserviert.claimedAt === null) return neuGelesen(ws, vpsJobId);
  const job = { ...reserviert, claimedAt: reserviert.claimedAt };

  if (vpsGone) return fehlerAbschliessen(ws, job, "Job auf dem VPS nicht mehr vorhanden");
  if (status.status === "error") return fehlerAbschliessen(ws, job, status.error || "Skill-Fehler auf dem VPS");

  // 3) PDF holen. Vorübergehende Fehler: Reservierung läuft nach 2 Minuten ab,
  // dann versucht es der nächste Cron-Lauf erneut.
  let ergebnis: Response;
  try {
    ergebnis = await abruf(`${vps.url}/jobs/${id}/result`, { headers: kopf });
  } catch {
    return { abschluss: { status: "laeuft" }, job };
  }
  if (ergebnis.status === 404) return fehlerAbschliessen(ws, job, "Ergebnis auf dem VPS nicht mehr vorhanden");
  if (!ergebnis.ok) return { abschluss: { status: "laeuft" }, job };

  const bytes = Buffer.from(await ergebnis.arrayBuffer());
  const fileName =
    parseFilenameFromContentDisposition(ergebnis.headers.get("content-disposition")) || `document-${vpsJobId}.pdf`;
  const mimeType = (ergebnis.headers.get("content-type") ?? "application/pdf").split(";")[0].trim() || "application/pdf";
  const check = validateDealDocumentUpload({ fileName, fileSize: bytes.length, documentType: job.documentType });
  if (!check.ok) return fehlerAbschliessen(ws, job, check.error);

  // 4) Eine Transaktion unter der Deal-Sperre: genau einmal, nie veraltet.
  let ablage: Awaited<ReturnType<typeof ablegenUnterSperre>>;
  try {
    ablage = await ablegenUnterSperre(job, {
      fileName,
      mimeType,
      fileSize: bytes.length,
      fileContent: bytes.toString("base64"),
      documentType: check.documentType,
    });
  } catch (err) {
    // Deal gelöscht oder in einem anderen Workspace: endgültig. Sonst nach Ablauf der Reservierung neu.
    if (err instanceof Error && err.message === "Deal nicht gefunden.") return fehlerAbschliessen(ws, job, err.message);
    console.error("[kv-job-abschluss]", vpsJobId, err);
    return { abschluss: { status: "laeuft" }, job };
  }
  if (ablage.art === "verloren") return neuGelesen(ws, vpsJobId);
  if (ablage.art === "verworfen") return { abschluss: { status: "verworfen", grund: "version_veraltet" }, job };
  const dokument = ablage.dokument;

  // Nachläufe erst nach dem Commit; Fehler dort brechen das Ablegen nicht.
  await dealDokumentNachlauf({ workspaceId: ws, dealRecordId: job.dealRecordId }, dokument.documentType).catch((err) =>
    console.error("[kv-job-abschluss] Nachlauf", err)
  );

  // 5) Rechnung mit Datensatz (Plan 9): Spiegel, Wartet, Abschluss aus dem Datensatz.
  //    Alte Jobs ohne Datensatz: „Rechnung fällig am“ wie bisher.
  let faellig: { rechnungFaelligAm: string | null; dueDateWarning?: string };
  if (job.invoiceId) {
    await nachRechnung(ws, job.dealRecordId, opts.updatedBy ?? job.createdBy);
    const r = await aktiveRechnung(ws, job.dealRecordId).catch(() => null);
    faellig = { rechnungFaelligAm: r?.faelligAm ?? null };
  } else {
    faellig = await applyInvoiceDueDate({
      documentType: check.documentType,
      workspaceId: ws,
      dealRecordId: job.dealRecordId,
      explicitDueDate: opts.faelligAm,
      updatedBy: opts.updatedBy ?? job.createdBy,
    });
  }

  return {
    abschluss: { status: "abgelegt", dealDocumentId: dokument.id },
    job,
    dokument,
    rechnungFaelligAm: faellig.rechnungFaelligAm,
    ...(faellig.dueDateWarning ? { dueDateWarning: faellig.dueDateWarning } : {}),
  };
}

export async function kvJobAbschliessen(
  ws: string,
  vpsJobId: string,
  opts?: { abruf?: typeof fetch; jetzt?: Date }
): Promise<JobAbschluss> {
  return (await kvJobAbschliessenDetails(ws, vpsJobId, opts)).abschluss;
}
