import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext, unauthorized, success } from "@/lib/api-utils";
import { runAITask } from "@/services/ai/run-task";
import { AI_TASK_SLUGS } from "@/services/ai/task-registry";
import { getDealInventory } from "@/services/deal-inventory";

export const maxDuration = 300;

const AdvisorResponseSchema = z.object({
  /** Kurze deutsche Antwort an den Operator (was geändert wurde und warum). */
  reply: z.string().min(1),
  /** Vollständiger neuer Paket-Satz oder null, wenn nur geantwortet wird. */
  proposal: z
    .object({
      options: z
        .array(
          z.object({
            catalogueSlug: z.string().nullish(),
            displayName: z.string().min(1),
            shortDescription: z.string().nullish(),
            priceEur: z.coerce.number().min(0),
            includedItems: z.array(z.string()).catch([]),
            excludedItems: z.array(z.string()).catch([]),
            addableItems: z.array(z.string()).catch([]),
            isRecommended: z.coerce.boolean().catch(false),
          })
        )
        .max(6),
    })
    .nullish()
    .catch(null),
});

const SYSTEM_PROMPT = `Du bist Paket-Berater eines deutschen Umzugsunternehmens im Angebots-Editor. Der Operator stellt gerade ein Paket-Angebot (z. B. Basis/Komfort/Premium) für einen konkreten Umzug zusammen und chattet mit dir, um Preise und Leistungsumfang anzupassen.

Du bekommst: die aktuellen Pakete (Preis, Enthalten-, Nicht-enthalten-Liste), die Inventarliste des Umzugs, die Kalkulationsannahmen (Anfahrt, Etagen, Zugang) und die Chat-Historie.

Regeln:
- Antworte IMMER als JSON: {"reply": "...", "proposal": {"options":[...]} | null}.
- reply: 1-4 deutsche Sätze — was du geändert hast und warum (kalkulatorische Begründung: Volumen, schwere Items, Etagen ohne Aufzug, Anfahrt).
- proposal: NUR wenn der Operator eine Änderung will — dann IMMER der KOMPLETTE neue Paket-Satz (alle Pakete, auch unveränderte), Felder: catalogueSlug, displayName, shortDescription, priceEur (Zahl in Euro), includedItems[], addableItems[], excludedItems[], isRecommended. Reine Fragen → proposal: null.
- DREI Stufen, streng unterscheiden:
  * includedItems = im Paketpreis enthalten (Haken).
  * addableItems = "auf Wunsch zubuchbar" gegen Aufpreis — sagt der Operator "zubuchbar", "optional", "zusätzlich buchbar", "auf Wunsch", gehört die Leistung HIERHIN, NIEMALS in excludedItems.
  * excludedItems = ausdrücklich ausgeschlossen, wird auch auf Wunsch nicht erbracht (durchgestrichen). Nur verwenden, wenn der Operator es klar so meint.
- Konsistenz: eine Leistung darf nur in EINER der drei Listen desselben Pakets stehen. Höhere Pakete enthalten mindestens die Leistungen der niedrigeren; was im höheren Paket enthalten ist, ist im niedrigeren typischerweise zubuchbar oder ausgeschlossen.
- Preise: plausibel gestaffelt, ganze Euro oder ,50. Erfinde keine Leistungen, die zum Inventar nicht passen.`;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { recordId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    messages?: Array<{ role: "user" | "assistant"; content: string }>;
    options?: unknown;
    assumptions?: unknown;
  };
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  if (messages.length === 0 || messages[messages.length - 1]?.role !== "user") {
    return NextResponse.json({ error: "letzte Nachricht muss vom Operator sein" }, { status: 400 });
  }

  const inventory = await getDealInventory(ctx.workspaceId, recordId);
  const invText = inventory.length
    ? inventory
        .map(
          (i) =>
            `- ${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ""}${i.moveFlag ? "" : " (kommt NICHT mit)"}${i.heavyFlag ? " [schwer]" : ""}${i.disassemblyRequired ? " [zerlegen]" : ""}`
        )
        .join("\n")
    : "(keine Inventarliste erfasst)";

  const prompt = [
    `# Aktuelle Pakete\n${JSON.stringify(body.options ?? [], null, 1)}`,
    `# Kalkulationsannahmen\n${JSON.stringify(body.assumptions ?? {}, null, 1)}`,
    `# Inventar\n${invText}`,
    `# Chat\n${messages.map((m) => `${m.role === "user" ? "OPERATOR" : "BERATER"}: ${m.content}`).join("\n")}`,
    `Antworte in EINEM Schritt nur mit dem JSON-Objekt.`,
  ].join("\n\n");

  const result = await runAITask({
    workspaceId: ctx.workspaceId,
    taskSlug: AI_TASK_SLUGS.DEAL_PACKAGE_ADVISOR,
    system: SYSTEM_PROMPT,
    prompt,
    schema: AdvisorResponseSchema,
    attachments: undefined,
    background: true,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return success(result.output);
}
