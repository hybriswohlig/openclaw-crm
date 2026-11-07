/**
 * Ablegen eines fertigen VPS-Dokuments an EINER Stelle (Plan 5a, Entscheidung 7).
 * Browser (`store-as-document`) und Cron (`/api/cron/render-jobs`) rufen beide
 * hierher. Doppelt abgelegt wird nie: vor dem Abruf des PDFs reserviert
 * `jobReservieren` den Job in einer Anweisung, nur einer gewinnt.
 *
 * Ablauf: Job laden → VPS-Status `/jobs/{id}` (ohne Reservierung, damit ein
 * noch laufender Job den Browser nicht zwei Minuten blockiert) → bei „done“
 * reservieren → `/jobs/{id}/result` → `jobAblage` gegen die Version der
 * Quotation von jetzt → `createDealDocument` mit oder ohne Version, oder
 * verwerfen (F4) → Job abschließen.
 */
import {
  jobAblage,
  jobReservierbar,
  type JobAbschluss,
  type RenderJob,
} from "@/lib/angebot-wahl";
import { jobAbschliessen, jobLaden, jobReservieren } from "@/services/render-jobs";
import {
  angebotsVersionId,
  createDealDocument,
  parseFilenameFromContentDisposition,
  validateDealDocumentUpload,
} from "@/services/deal-documents";
import { applyInvoiceDueDate } from "@/services/rechnung-faellig";

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

async function fehlerAbschliessen(ws: string, job: RenderJob, fehler: string): Promise<AbschlussDetails> {
  await jobAbschliessen(ws, job.vpsJobId, { status: "fehler", fehler });
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
  const job = await jobReservieren(ws, vpsJobId, jetzt);
  if (!job) {
    const jetztGeladen = await jobLaden(ws, vpsJobId);
    return {
      abschluss: jetztGeladen ? nichtReservierbar(jetztGeladen) : { status: "laeuft" },
      job: jetztGeladen,
    };
  }

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

  // 4) Version erst jetzt vergleichen: so kurz wie möglich vor dem Ablegen.
  const quotationVersionId =
    job.documentType === "quotation" && job.calculationVersionId !== null
      ? await angebotsVersionId(job.dealRecordId)
      : null;
  const ablage = jobAblage(job, quotationVersionId);
  if (ablage === "verwerfen") {
    await jobAbschliessen(ws, job.vpsJobId, { status: "verworfen" });
    return { abschluss: { status: "verworfen", grund: "version_veraltet" }, job };
  }

  const dokument = await createDealDocument({
    workspaceId: ws,
    dealRecordId: job.dealRecordId,
    documentType: check.documentType,
    fileName,
    fileSize: bytes.length,
    mimeType,
    fileContent: bytes.toString("base64"),
    calculationVersionId: ablage === "mit_version" ? job.calculationVersionId : null,
  });
  await jobAbschliessen(ws, job.vpsJobId, { status: "abgelegt", dealDocumentId: dokument.id });

  // 5) Rechnung: „Rechnung fällig am“ wie bisher in store-as-document.
  const faellig = await applyInvoiceDueDate({
    documentType: check.documentType,
    workspaceId: ws,
    dealRecordId: job.dealRecordId,
    explicitDueDate: opts.faelligAm,
    updatedBy: opts.updatedBy ?? job.createdBy,
  });

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
