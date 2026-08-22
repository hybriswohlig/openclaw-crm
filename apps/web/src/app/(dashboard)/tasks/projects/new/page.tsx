"use client";

// Project creation wizard (Mockup 3 / Spec §8.3). Five steps, one AI call at
// the 1 → 2 transition, one transactional POST at the end.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import type { PlanGenerateJSON } from "@/lib/work-types";
import { readApiError } from "@/lib/work-ui";
import { ModuleNav } from "@/components/work/module-nav";
import {
  clampDuration,
  clampOffset,
  draftId,
  emptyDraft,
  WIZARD_DRAFT_KEY,
  WIZARD_DRAFT_VERSION,
  WIZARD_STEPS,
  type WizardDraft,
} from "./_components/wizard-types";
import { NextStepsRail, ProjectPreviewRail } from "./_components/wizard-rails";
import { StepBasics } from "./_components/step-basics";
import { StepScope } from "./_components/step-scope";

export default function NewProjectPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [draft, setDraft] = useState<WizardDraft>(() => emptyDraft());
  const [restorable, setRestorable] = useState<WizardDraft | null>(null);
  // Mirroring only starts after the first real user edit AND only once any
  // pending "Entwurf fortsetzen?" offer has been answered — otherwise the
  // mirror effect fires ~400 ms after mount with the still-empty draft and
  // overwrites the very draft the banner is offering (defect R1).
  const [dirty, setDirty] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  // The German reason, or null. NOT a boolean: the route answers 200 on
  // failure and puts the reason in data.error, which the user must see (R7.1).
  const [aiError, setAiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Offer to resume a draft instead of silently overwriting the form.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WIZARD_DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<WizardDraft> | null;
      // A draft written by an older shape is discarded, not restored: a single
      // missing array would white-screen the preview rail on every reload (R2).
      if (!parsed || parsed.version !== WIZARD_DRAFT_VERSION) {
        window.localStorage.removeItem(WIZARD_DRAFT_KEY);
        return;
      }
      if (parsed.name || parsed.shortDescription || (parsed.phases?.length ?? 0) > 0) {
        setRestorable(parsed as WizardDraft);
      }
    } catch {
      // Corrupt draft: drop it rather than blocking the wizard forever.
      try {
        window.localStorage.removeItem(WIZARD_DRAFT_KEY);
      } catch {
        /* noop */
      }
    }
  }, []);

  // Mirror, debounced. Two guards, both load-bearing:
  //   `dirty`      — nothing is written before the user's first real edit, so
  //                  an unanswered restore offer survives being ignored.
  //   `!restorable`— while the banner is up we must not clobber what it offers.
  useEffect(() => {
    if (!dirty || restorable) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(
          WIZARD_DRAFT_KEY,
          JSON.stringify({ ...draft, version: WIZARD_DRAFT_VERSION, savedAt: new Date().toISOString() })
        );
      } catch {
        // Quota or private mode — the wizard keeps working in memory.
      }
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draft, dirty, restorable]);

  const patch = useCallback((updates: Partial<WizardDraft>) => {
    setDirty(true);
    setDraft((prev) => ({ ...prev, ...updates }));
  }, []);

  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(WIZARD_DRAFT_KEY);
    } catch {
      /* noop */
    }
  }, []);

  const runPlanGeneration = useCallback(async () => {
    setAiRunning(true);
    setAiError(null);
    try {
      const res = await fetch("/api/v1/projects/plan-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          shortDescription: draft.shortDescription,
          category: draft.category,
          priority: draft.priority,
          startDate: draft.startDate,
          endDate: draft.endDate,
          problemStatement: draft.problemStatement,
          goalStatement: draft.goalStatement,
          successCriteria: draft.successCriteria,
          scopeIn: draft.scopeIn,
          scopeOut: draft.scopeOut,
        }),
      });
      if (!res.ok) {
        setAiError(await readApiError(res, "Der Planungsdienst ist gerade nicht erreichbar."));
        return;
      }
      const json = await res.json();
      // The envelope is { data: { plan, error } } — the plan is at
      // json.data.plan, NOT at json.data. Unwrapping one level too few gives a
      // truthy wrapper whose every field is undefined, which looks exactly
      // like a successful empty plan and wipes the wizard while toasting
      // success (defect W1). The route answers 200 even on failure, so the
      // `error` field is the only signal there is.
      const payload = (json?.data ?? null) as PlanGenerateJSON | null;
      const plan = payload?.plan ?? null;
      if (!plan || payload?.error) {
        // aiRan stays false so "Weiter" retries instead of skipping silently.
        setAiError(payload?.error ?? "Es kam kein verwertbarer Vorschlag zurück.");
        return;
      }

      const phaseDrafts = (plan.phases ?? []).map((ph) => ({
        id: draftId(),
        name: ph.name,
        description: ph.description ?? "",
        startOffsetDays: clampOffset(ph.startOffsetDays ?? 0),
        durationDays: clampDuration(ph.durationDays ?? 14),
        tasks: (ph.tasks ?? []).map((tk) => ({
          id: draftId(),
          title: tk.title,
          description: tk.description ?? "",
          offsetDays: clampOffset(tk.offsetDays ?? 0),
          priority: tk.priority ?? "mittel",
        })),
      }));

      setDirty(true);
      setDraft((prev) => ({
        ...prev,
        // Merge, never replace: whatever the user typed in step 1 survives.
        scopeIn: dedupe([...prev.scopeIn, ...(plan.scopeIn ?? [])]),
        scopeOut: dedupe([...prev.scopeOut, ...(plan.scopeOut ?? [])]),
        // Ids are minted here, once, and never derived from array position:
        // every one of these lists has a delete button, so an index key would
        // move DOM state (focus, caret, expanded card) onto the wrong row (R11).
        phases: phaseDrafts,
        // The AI names phases by INDEX; we resolve that to the id we just
        // minted, so a later delete cannot silently re-point a milestone.
        milestones: (plan.milestones ?? []).map((m) => ({
          id: draftId(),
          name: m.name,
          phaseId:
            typeof m.phaseIndex === "number" && phaseDrafts[m.phaseIndex]
              ? phaseDrafts[m.phaseIndex].id
              : null,
          offsetDays: clampOffset(m.offsetDays ?? 0),
        })),
        risks: (plan.risks ?? []).map((r) => ({
          id: draftId(),
          title: r.title,
          description: r.description ?? "",
          severity: r.severity ?? "mittel",
          mitigation: r.mitigation ?? "",
        })),
        aiRan: true,
      }));
      setAiError(null);
      toast.success("Vorschlag übernommen — alles ist editierbar.");
    } catch {
      setAiError("Netzwerkfehler beim Planungsdienst.");
    } finally {
      setAiRunning(false);
    }
  }, [draft]);

  const goNext = useCallback(async () => {
    // Exactly one SUCCESSFUL AI call, at the 1 → 2 transition (Spec §8.3).
    // A failure leaves aiRan false, so pressing "Weiter" again retries — and
    // the wizard still advances either way, because the AI is optional.
    if (draft.step === 1 && !draft.aiRan) {
      await runPlanGeneration();
    }
    setDraft((prev) => ({ ...prev, step: Math.min(5, prev.step + 1) }));
  }, [draft.step, draft.aiRan, runPlanGeneration]);

  // Default the project lead to the signed-in user. Deliberately NOT via
  // patch(): a machine-supplied default is not a user edit and must not start
  // mirroring, or it would overwrite a pending restorable draft (R1).
  useEffect(() => {
    if (session?.user?.id && !draft.ownerUserId) {
      setDraft((prev) => (prev.ownerUserId ? prev : { ...prev, ownerUserId: session.user.id }));
    }
  }, [session?.user?.id, draft.ownerUserId]);

  const canContinue =
    draft.step !== 1 ||
    (draft.name.trim().length > 0 &&
      draft.shortDescription.trim().length > 0 &&
      draft.category.length > 0 &&
      draft.ownerUserId.length > 0);

  return (
    <div className="k-paper-noise min-h-full">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
        <div>
          <div className="k-label mb-1" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
            <Link href="/tasks/projects" style={{ color: "inherit" }}>
              Projekte
            </Link>{" "}
            / Neu
          </div>
          <h1 className="k-display" style={{ margin: 0, fontSize: "clamp(24px, 4vw, 32px)", lineHeight: 1.05 }}>
            Neues Projekt anlegen
          </h1>
        </div>

        <ModuleNav />

        {restorable && (
          <div className="k-card flex flex-wrap items-center gap-3 p-3">
            <RotateCcw className="h-4 w-4 shrink-0" style={{ color: "var(--kottke-accent)" }} />
            <span className="flex-1 text-[13px]" style={{ color: "var(--foreground)" }}>
              Du hast einen gespeicherten Entwurf
              {restorable.name ? ` („${restorable.name}")` : ""}. Fortsetzen?
            </span>
            <button
              type="button"
              onClick={() => {
                // Merge over a fresh draft: even a version-matching stored
                // object can be missing a field, and the rails index into
                // every array without defence (R2).
                setDraft({ ...emptyDraft(), ...restorable, version: WIZARD_DRAFT_VERSION });
                setRestorable(null);
                setDirty(true);
              }}
              className="rounded-lg px-3 py-1 text-[12.5px] font-medium"
              style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
            >
              Entwurf fortsetzen
            </button>
            <button
              type="button"
              onClick={() => {
                clearDraft();
                setRestorable(null);
              }}
              className="rounded-lg border border-border px-3 py-1 text-[12.5px] text-muted-foreground hover:bg-muted"
            >
              Verwerfen
            </button>
          </div>
        )}

        {/* ── Schrittleiste ─────────────────────────────────────── */}
        <ol className="flex flex-wrap items-center gap-2">
          {WIZARD_STEPS.map((s) => {
            const state = s.n === draft.step ? "current" : s.n < draft.step ? "done" : "todo";
            return (
              <li key={s.n} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => s.n < draft.step && setDraft((prev) => ({ ...prev, step: s.n }))}
                  disabled={s.n > draft.step}
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-[6px] text-[12.5px] font-medium transition-colors disabled:cursor-default"
                  style={{
                    background:
                      state === "current"
                        ? "var(--kottke-accent)"
                        : state === "done"
                          ? "color-mix(in oklch, var(--ok) 14%, transparent)"
                          : "transparent",
                    borderColor:
                      state === "current"
                        ? "var(--kottke-accent)"
                        : state === "done"
                          ? "color-mix(in oklch, var(--ok) 38%, transparent)"
                          : "var(--border)",
                    color:
                      state === "current"
                        ? "var(--accent-ink)"
                        : state === "done"
                          ? "var(--ok)"
                          : "var(--muted-foreground)",
                  }}
                >
                  <span className="k-mono">{s.n}</span>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {s.n < 5 && <span style={{ color: "var(--muted-foreground)" }}>·</span>}
              </li>
            );
          })}
        </ol>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="k-card min-w-0 p-5">
            {aiError && draft.step >= 2 && (
              <div
                className="mb-4 flex items-start gap-2 rounded-lg border p-3 text-[12.5px]"
                style={{
                  borderColor: "color-mix(in oklch, var(--warn) 38%, transparent)",
                  background: "color-mix(in oklch, var(--warn) 10%, transparent)",
                  color: "var(--foreground)",
                }}
              >
                <Sparkles className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: "var(--warn)" }} />
                <div className="flex-1">
                  <b style={{ fontWeight: 500 }}>Kein KI-Vorschlag verfügbar.</b> {aiError} Du kannst Scope,
                  Phasen, Meilensteine und Risiken hier von Hand anlegen — das Projekt lässt sich genauso
                  vollständig erstellen.
                </div>
                <button
                  type="button"
                  onClick={() => setAiError(null)}
                  aria-label="Hinweis schliessen"
                  className="shrink-0"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  <X className="h-[14px] w-[14px]" />
                </button>
              </div>
            )}

            {draft.step === 2 && (
              <button
                type="button"
                onClick={runPlanGeneration}
                disabled={aiRunning}
                className="mb-4 inline-flex h-8 items-center gap-2 rounded-lg border border-border px-3 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {aiRunning ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <Sparkles className="h-[13px] w-[13px]" />}
                Vorschlag neu generieren
              </button>
            )}

            {draft.step === 1 && <StepBasics draft={draft} patch={patch} />}
            {draft.step === 2 && <StepScope draft={draft} patch={patch} />}
            {/* Task 30: Schritt 3 */}
            {/* Task 31: Schritt 4 */}
            {/* Task 32: Schritt 5 */}

            {/* ── Navigation ──────────────────────────────────── */}
            <div className="mt-5 flex items-center justify-between gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => patch({ step: Math.max(1, draft.step - 1) })}
                disabled={draft.step === 1}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-[13.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-40"
              >
                <ArrowLeft className="h-[15px] w-[15px]" />
                Zurück
              </button>
              {draft.step < 5 ? (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canContinue || aiRunning}
                  className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13.5px] font-medium disabled:opacity-50"
                  style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
                >
                  {aiRunning ? (
                    <>
                      <Loader2 className="h-[15px] w-[15px] animate-spin" />
                      KI plant…
                    </>
                  ) : (
                    <>
                      Weiter
                      <ArrowRight className="h-[15px] w-[15px]" />
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting}
                  className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13.5px] font-medium disabled:opacity-50"
                  style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
                >
                  {submitting ? <Loader2 className="h-[15px] w-[15px] animate-spin" /> : <Sparkles className="h-[15px] w-[15px]" />}
                  Projekt erstellen
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <ProjectPreviewRail draft={draft} />
            <NextStepsRail step={draft.step} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Case-insensitive de-duplication that keeps the first spelling. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = v.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v.trim());
  }
  return out;
}
