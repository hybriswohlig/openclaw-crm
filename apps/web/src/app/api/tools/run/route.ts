// apps/web/src/app/api/tools/run/route.ts
//
// Start a job on the crm-tools FastAPI. Returns { job_id } to the browser.
// The browser then polls /api/tools/jobs/<id> until status=done.
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, badRequest } from "@/lib/api-utils";
import { db } from "@/db";
import { dealInvoices } from "@/db/schema/deal-invoices";
import { eq } from "drizzle-orm";
import { rewriteKundeParamsFromDeal } from "@/services/doc-customer-name";
import { kundeAdresseErgaenzen } from "@/services/doc-kunde-adresse";
import {
  assertDealInWorkspace,
  attachDocumentJobContext,
  type KvJobBezug,
} from "@/services/document-job-context";
import { jobAnlegen } from "@/services/render-jobs";
import { kvEditorBeimNeuenKv, kvEditorStandZumNeuenKv } from "@/services/kv-editor-haken";
import { abgleichen } from "@/lib/kv-editor-anwenden";
import type { AbgleichErgebnis, KvGrundlageVps, KvPreisPruefung } from "@/lib/kv-editor";
import type { QuotationDocumentDetails } from "@/db/schema/quotations";
import { fotosLaden, vpsJobStarten } from "@/services/vps-dokument-start";
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

/**
 * Grundlage eines neuen VPS-Stands (Spec 4.2): nur die Auswahl im Dialog, vor dem Paketbau gelesen.
 * Fotos, wie angefordert (ausgeblendete wirken über Änderungen `bilder:<id>:zeigen`).
 */
function grundlageAus(params: Record<string, unknown>): KvGrundlageVps {
  const details = (params.document_details && typeof params.document_details === "object"
    ? params.document_details
    : {}) as QuotationDocumentDetails;
  const anweisung = typeof params.anweisung === "string" && params.anweisung.trim() ? params.anweisung.trim() : undefined;
  const bildIds = Array.isArray(params._image_attachment_ids)
    ? (params._image_attachment_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  return {
    ...(anweisung ? { anweisung } : {}),
    ...(details.kitchen ? { kitchen: structuredClone(details.kitchen) } : {}),
    bildIds,
  };
}

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
  // KV-Editor: den Stand bestimmt nur der Server (Plan 2c), nie der Browser.
  delete params._kv_stand;
  // KV-Editor (Spec 7.6): neuer KV aus der Kalkulation. Quelle, Abgleich und Grundlage des Stands.
  let kvEditor: {
    quelleId: string | null;
    abgleich: AbgleichErgebnis;
    grundlage: KvGrundlageVps;
    pruefung: KvPreisPruefung | null;
  } | null = null;
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
        const kvDeal =
          String(params.document_type ?? "").toUpperCase() === "KV" && typeof params._deal_record_id === "string"
            ? params._deal_record_id
            : null;
        const quelle = kvDeal ? (await kvEditorBeimNeuenKv(ctx.workspaceId, kvDeal)).quelle : null;
        const grundlage = kvDeal ? grundlageAus(params) : null;
        let abgleich: AbgleichErgebnis = { liste: [], konflikte: [] };
        const kontext = await attachDocumentJobContext(ctx.workspaceId, params, {
          aenderungen: (basis) => {
            if (quelle) abgleich = abgleichen(basis, quelle.aenderungen, quelle.offen);
            return abgleich.liste;
          },
        });
        params = kontext.params;
        kvBezug = kontext.kv;
        reBezug = kontext.re ?? null;
        if (grundlage && kvBezug) {
          kvEditor = {
            quelleId: quelle?.id ?? null,
            abgleich,
            grundlage,
            pruefung: kontext.kvPreise ? { ...kontext.kvPreise, preis: "offen", fehlt: [], fremd: [] } : null,
          };
        }
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
  const fotos = await fotosLaden(ctx.workspaceId, registerDeal, requestedIds);
  if (!fotos.ok) return NextResponse.json({ error: fotos.error }, { status: fotos.status });
  if (fotos.images.length > 0) params._images = fotos.images;

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

  let vps: Awaited<ReturnType<typeof vpsJobStarten>>;
  try {
    vps = await vpsJobStarten({
      ws: ctx.workspaceId,
      userId: ctx.userId,
      skill: body.skill,
      params,
      timeoutSec: body.timeout_sec,
    });
  } catch (err) {
    await verwerfen("VPS nicht erreichbar");
    throw err;
  }

  if (!vps.ok && vps.status === 413 && params._images) {
    await verwerfen("VPS: Anfrage zu groß");
    return NextResponse.json(
      {
        error:
          "Der Dokumentjob ist mit Fotos zu groß. Es wird nicht ohne Fotos wiederholt. Bitte weniger oder kleinere Dateien wählen.",
      },
      { status: 413 }
    );
  }

  if (!vps.ok && vps.status >= 400) {
    await verwerfen(`VPS-Fehler ${vps.status}`);
    return NextResponse.json(
      { error: "upstream error", upstream: vps.data },
      { status: vps.status }
    );
  }

  // Job-Register: Dokument-Skills mit Deal. Abgelegt wird nur, was hier steht.
  const data = vps.data;
  const documentType = registerTyp(body.skill, params);
  if (rechnung && !vps.ok) await verwerfen("VPS ohne Job-ID");
  if (vps.ok && registerDeal && documentType) {
    const jobId = vps.jobId;
    const job = {
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
    };
    try {
      const editor = documentType === "quotation" ? kvEditor : null;
      if (editor) {
        // Spec 7.6 Schritt 3: Stand und Job in einer Transaktion; der Cron sieht den Job erst nach dem Commit.
        await db.transaction(async (tx) => {
          const stand = await kvEditorStandZumNeuenKv(tx, ctx.workspaceId, registerDeal, {
            renderer: "vps",
            grundlage: editor.grundlage,
            aenderungen: editor.abgleich.liste,
            offen: editor.abgleich.konflikte,
            quelleId: editor.quelleId,
            calculationVersionId: job.calculationVersionId,
            renderJobId: jobId,
            dealDocumentId: null,
            pruefung: editor.pruefung,
            userId: ctx.userId,
          });
          await jobAnlegen({ ...job, kvStandId: stand.id, kvStandZiel: "aktuell" }, tx);
        });
      } else {
        await jobAnlegen(job);
      }
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
