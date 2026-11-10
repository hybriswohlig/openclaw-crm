// apps/web/src/app/api/tools/run/route.ts
//
// Start a job on the crm-tools FastAPI. Returns { job_id } to the browser.
// The browser then polls /api/tools/jobs/<id> until status=done.
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest } from "@/lib/api-utils";
import { db } from "@/db";
import { inboxMessageAttachments } from "@/db/schema/inbox";
import { dealInvoices } from "@/db/schema/deal-invoices";
import { and, eq, inArray } from "drizzle-orm";
import { findDealInternalPhotosByIds } from "@/services/deal-photos";
import { rewriteKundeParamsFromDeal } from "@/services/doc-customer-name";
import { kundeAdresseErgaenzen } from "@/services/doc-kunde-adresse";
import {
  assertDealInWorkspace,
  attachDocumentJobContext,
  type KvJobBezug,
} from "@/services/document-job-context";
import { jobAnlegen } from "@/services/render-jobs";
import { type ReJobBezug } from "@/services/document-job-context";
import { angebotSperren, quotationLesen } from "@/services/quotations";
import {
  angebotsStandAus,
  rechnungPruefenUndReservieren,
  rechnungsVorschlag,
  rechnungVerwerfen,
} from "@/services/rechnungen";
import { GeldFehler, stundenPreiseFuerVps, type RechnungZeile } from "@/lib/geld";
import { parseRechnungEingabe } from "@/lib/commercial-document-request";
import { angabenFehlenText, dokArtAus, fehlendeVpsAngaben } from "@/lib/dokument-angaben";

/** Dokumentart des Skills → Typ in `deal_documents` (wie `store-as-document`). */
const DOKUMENT_TYP: Record<string, string> = {
  KV: "quotation",
  AB: "order_confirmation",
  RE: "invoice",
};

/**
 * Typ des Register-Eintrags (Plan 5a, Entscheidung 6 und Fix-Welle Fund 4):
 * Rechnungs-Skill nach `document_type`, Auftragsanweisung immer
 * `worker_instructions`. Andere Skills kommen nicht ins Register.
 */
function registerTyp(skill: string, params: Record<string, unknown>): string | null {
  if (skill === "auftragsanweisung") return "worker_instructions";
  if (skill === "rechnungen-und-auftragsbestaetigungen") {
    return DOKUMENT_TYP[String(params.document_type ?? "").toUpperCase()] ?? null;
  }
  return null;
}

const CRM_TOOLS_API_URL = process.env.CRM_TOOLS_API_URL;
const CRM_TOOLS_AUTH_TOKEN = process.env.CRM_TOOLS_AUTH_TOKEN;

/** Skills whose PDF header uses params.kunde — always rewrite from the deal. */
const KUNDE_SKILLS = new Set([
  "rechnungen-und-auftragsbestaetigungen",
  "auftragsanweisung",
]);

// Cap on the base64 image payload we forward to FastAPI. Measured as the
// JSON-encoded size (i.e. base64 string length), since that's what actually
// goes on the wire. ~3 MB leaves headroom under the upstream FastAPI's
// request-body limit, which rejects larger bodies with 413.
// Previous 8-image / 3 MB cap dropped customer photos silently. Fail visibly
// instead of retrying without images. 12 MB still has to fit the VM body limit.
const MAX_IMAGE_BASE64_BYTES_TOTAL = 12 * 1024 * 1024;
const MAX_IMAGES_FORWARDED = 40;

interface RunBody {
  skill: string;
  params?: Record<string, unknown>;
  timeout_sec?: number;
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  if (!CRM_TOOLS_API_URL || !CRM_TOOLS_AUTH_TOKEN) {
    return NextResponse.json(
      { error: "crm-tools env not configured" },
      { status: 500 }
    );
  }

  const body = (await req.json()) as RunBody;
  if (!body.skill || typeof body.skill !== "string") {
    return badRequest("skill is required");
  }

  // Whitelist what the browser is allowed to ask for — guards against the UI
  // accidentally exposing an unfinished skill.
  const ALLOWED_SKILLS = new Set([
    "echo-test",
    "rechnungen-und-auftragsbestaetigungen",
    "auftragsanweisung",
  ]);
  if (!ALLOWED_SKILLS.has(body.skill)) {
    return badRequest(`skill '${body.skill}' is not allowed`);
  }

  // If the dialog sent _image_attachment_ids, resolve them to base64 payloads
  // server-side and inline them into params._images. We never let the browser
  // upload raw image bytes here — IDs only, dereferenced under the user's
  // workspace scope. This is what gives the headless skill image context
  // (apartment photos etc.) for volume / Stockwerk / besonderheiten.
  let params: Record<string, unknown> = { ...(body.params ?? {}) };
  let kvBezug: KvJobBezug | null = null;
  let reBezug: ReJobBezug | null = null;
  // Plan 9: Rechnungsschritt der Akte (`_rechnung`), nie an den VPS.
  const rechnungRoh = parseRechnungEingabe(params._rechnung);
  delete params._rechnung;
  if (!rechnungRoh.ok) return badRequest(rechnungRoh.error);

  // Authoritative kunde name: never trust the browser for the PDF header.
  // Stale client bundles (or lead-title leakage into person names) previously
  // printed "Kyra Heiker — Weil der Stadt → …" above the address.
  if (KUNDE_SKILLS.has(body.skill)) {
    try {
      params = await rewriteKundeParamsFromDeal(ctx.workspaceId, params);
    } catch (err) {
      console.warn("[tools/run] kunde rewrite failed, using client payload:", err);
    }
    if (body.skill === "rechnungen-und-auftragsbestaetigungen") {
      // Nie einen Job starten, der absehbar scheitert: ohne Kundenanschrift oder Namen
      // bricht die Vorlage mit „skill exited with code 2 … Kundenanschrift fehlt“ ab.
      // Anschrift wie den Namen serverseitig aus dem Lead (sonst aus auftrag.strecke_von) ergänzen.
      try {
        params = await kundeAdresseErgaenzen(ctx.workspaceId, params);
      } catch (err) {
        console.warn("[tools/run] Kundenanschrift aus dem Lead nicht geladen:", err);
      }
      const fehlt = fehlendeVpsAngaben(params);
      if (fehlt.length > 0) {
        return NextResponse.json(
          { error: angabenFehlenText(dokArtAus(params.document_type), fehlt), code: "ANGABEN_FEHLEN", fehlend: fehlt },
          { status: 400 }
        );
      }
      try {
        const kontext = await attachDocumentJobContext(ctx.workspaceId, params);
        params = kontext.params;
        kvBezug = kontext.kv;
        reBezug = kontext.re ?? null;
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Dokumentkontext fehlgeschlagen" },
          { status: 400 }
        );
      }
    }
  }

  // Deal für das Register. Beim Rechnungs-Skill prüft attachDocumentJobContext den
  // Workspace; bei der Auftragsanweisung hier, vor dem Start auf dem VPS.
  const registerDeal = typeof params._deal_record_id === "string" ? params._deal_record_id : null;
  if (registerDeal && body.skill === "auftragsanweisung" && !(await assertDealInWorkspace(ctx.workspaceId, registerDeal))) {
    return NextResponse.json({ error: "Auftrag gehört nicht zu diesem Workspace." }, { status: 400 });
  }

  const requestedIds = Array.isArray(params._image_attachment_ids)
    ? (params._image_attachment_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  delete params._image_attachment_ids;
  if (requestedIds.length > MAX_IMAGES_FORWARDED) {
    return NextResponse.json(
      { error: `Zu viele Fotos (${requestedIds.length}). Höchstens ${MAX_IMAGES_FORWARDED} Dateien.` },
      { status: 400 }
    );
  }
  if (requestedIds.length > 0) {
    const dealId = typeof params._deal_record_id === "string" ? params._deal_record_id : null;
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
        and(
          eq(inboxMessageAttachments.workspaceId, ctx.workspaceId),
          inArray(inboxMessageAttachments.id, requestedIds)
        )
      );

    const byId = new Map(rows.map((r) => [r.id, r]));
    const missing = requestedIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      const internal = await findDealInternalPhotosByIds(
        ctx.workspaceId,
        missing,
        dealId ?? undefined
      );
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
    const images: { filename: string; mime: string; base64: string }[] = [];
    let totalBase64Bytes = 0;
    for (const id of requestedIds) {
      const r = byId.get(id);
      if (!r) {
        return NextResponse.json(
          { error: `Foto ${id} gehört nicht zu diesem Workspace.` },
          { status: 403 }
        );
      }
      if (dealId && r.dealRecordId && r.dealRecordId !== dealId) {
        return NextResponse.json(
          { error: `Foto ${r.fileName} gehört nicht zu diesem Auftrag.` },
          { status: 403 }
        );
      }
      if (!r.mimeType.startsWith("image/")) continue;
      const base64Len = r.fileContent.length;
      if (totalBase64Bytes + base64Len > MAX_IMAGE_BASE64_BYTES_TOTAL) {
        return NextResponse.json(
          {
            error:
              "Die ausgewählten Fotos sind zu groß für den Dokumentjob. Bitte kleinere Dateien wählen. Es werden keine Dokumente ohne die angeforderten Fotos erzeugt.",
          },
          { status: 413 }
        );
      }
      totalBase64Bytes += base64Len;
      images.push({ filename: r.fileName, mime: r.mimeType, base64: r.fileContent });
    }
    if (images.length !== requestedIds.filter((id) => byId.get(id)?.mimeType.startsWith("image/")).length) {
      return NextResponse.json(
        { error: "Nicht alle angeforderten Fotos konnten geladen werden." },
        { status: 400 }
      );
    }
    if (images.length > 0) params._images = images;
  }

  // Plan 9, Entscheidung 6: Rechnung prüfen und mit Nummer reservieren, bevor der VPS startet.
  let rechnung: RechnungZeile | null = null;
  const istRechnung = registerTyp(body.skill, params) === "invoice";
  if (istRechnung) {
    if (!registerDeal || !reBezug) {
      return NextResponse.json({ error: "Rechnung braucht einen Auftrag mit Angebot." }, { status: 400 });
    }
    const bezug = reBezug;
    try {
      rechnung = await db.transaction(async (tx) => {
        await angebotSperren(tx, registerDeal);
        const stand = await quotationLesen(tx, registerDeal);
        if (!stand || angebotsStandAus(stand) !== bezug.angebotsStand) {
          throw new GeldFehler("RECHNUNG_PDF_ANDERS", "Das Angebot hat sich gerade geändert. Bitte die Rechnung neu erstellen.");
        }
        return rechnungPruefenUndReservieren(tx, {
          ws: ctx.workspaceId,
          deal: registerDeal,
          herkunft: "vps",
          pdfBetragCent: bezug.pdfBetragCent,
          eingabe: {
            bruttoCent: rechnungRoh.value?.bruttoCent ?? null,
            abweichungGrund: rechnungRoh.value?.abweichungGrund ?? null,
            faelligAm: typeof params.rechnung_faellig_am === "string" ? params.rechnung_faellig_am : null,
          },
          durchAgent: ctx.authMethod === "api_key",
          userId: ctx.userId,
          jetzt: new Date(),
        });
      });
    } catch (err) {
      if (err instanceof GeldFehler) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      throw err;
    }
    params.rechnungsnummer = rechnung.nummer;
    params.faellig_am = rechnung.faelligAm;
    if (bezug.istStunden && rechnung.bruttoCent != null) {
      const vorschlag = await rechnungsVorschlag(ctx.workspaceId, registerDeal).catch(() => null);
      const grundlage =
        vorschlag?.stunden && vorschlag.stunden.bruttoCent === rechnung.bruttoCent
          ? vorschlag.stunden.grundlage
          : "laut Stundennachweis";
      const prev = (params.preise && typeof params.preise === "object" ? params.preise : {}) as Record<string, unknown>;
      params.preise = { ...prev, ...stundenPreiseFuerVps(bezug.firma, rechnung.bruttoCent, grundlage) };
      const kontext = (params._document_context ?? {}) as Record<string, unknown>;
      params._document_context = { ...kontext, totalCents: rechnung.bruttoCent };
    }
  }
  const verwerfen = async (grund: string) => {
    if (rechnung) await rechnungVerwerfen(ctx.workspaceId, rechnung.id, grund).catch(() => {});
  };

  const upstreamUrl = `${CRM_TOOLS_API_URL}/skills/${encodeURIComponent(body.skill)}`;
  const buildBody = (p: Record<string, unknown>) =>
    JSON.stringify({
      params: {
        ...p,
        // Always tag the workspace so the skill has the right scope. The
        // skill can decide whether to use it.
        _workspace_id: ctx.workspaceId,
        _user_id: ctx.userId,
      },
      timeout_sec: body.timeout_sec,
    });
  const callUpstream = (p: Record<string, unknown>) =>
    fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CRM_TOOLS_AUTH_TOKEN}`,
      },
      body: buildBody(p),
    });

  let upstream: Response;
  try {
    upstream = await callUpstream(params);
  } catch (err) {
    await verwerfen("VPS nicht erreichbar");
    throw err;
  }

  if (upstream.status === 413 && params._images) {
    await verwerfen("VPS: Anfrage zu groß");
    return NextResponse.json(
      {
        error:
          "Der Dokumentjob ist mit Fotos zu groß. Es wird nicht ohne Fotos wiederholt. Bitte weniger oder kleinere Dateien wählen.",
      },
      { status: 413 }
    );
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    await verwerfen(`VPS-Fehler ${upstream.status}`);
    return NextResponse.json(
      { error: "upstream error", upstream: data },
      { status: upstream.status }
    );
  }

  // Job-Register: Dokument-Skills mit Deal. Abgelegt wird nur, was hier steht.
  const jobId = (data as { job_id?: unknown }).job_id;
  const documentType = registerTyp(body.skill, params);
  if (rechnung && typeof jobId !== "string") await verwerfen("VPS ohne Job-ID");
  if (registerDeal && typeof jobId === "string" && documentType) {
    try {
      await jobAnlegen({
        vpsJobId: jobId,
        workspaceId: ctx.workspaceId,
        dealRecordId: registerDeal,
        documentType,
        calculationVersionId: documentType === "quotation" ? (kvBezug?.calculationVersionId ?? null) : null,
        priceCents:
          documentType === "quotation"
            ? (kvBezug?.priceCents ?? null)
            : documentType === "invoice"
              ? (rechnung?.bruttoCent ?? null)
              : null,
        createdBy: ctx.userId,
        invoiceId: rechnung?.id ?? null,
      });
      if (rechnung) {
        await db.update(dealInvoices).set({ renderJobId: jobId }).where(eq(dealInvoices.id, rechnung.id));
      }
    } catch (err) {
      // Ohne Eintrag kann weder Browser noch Cron ablegen: sichtbar scheitern.
      console.error("[tools/run] Job-Register fehlgeschlagen:", err);
      await verwerfen("Job-Register fehlgeschlagen");
      return NextResponse.json(
        { error: "Dokumentjob gestartet, aber nicht registriert. Bitte erneut erstellen." },
        { status: 500 }
      );
    }
  }
  return NextResponse.json(data);
}
