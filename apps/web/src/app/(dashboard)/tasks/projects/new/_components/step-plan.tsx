"use client";

// Wizard step 3 — the proposed phases with their tasks, the milestones and
// the budget frame. Every date here is an offset in days from the project
// start, so the AI output never depends on the model's system date (Spec §9);
// the preview shows the resolved date next to each field.
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { PRIORITIES } from "@/lib/task-priority";
import { formatDateDE } from "@/lib/work-ui";
import type { WizardDraft } from "./wizard-types";
import { clampDuration, clampOffset, draftId, offsetToISO, phaseEndISO } from "./wizard-types";
import { Field, StepHeading, inputClass, textareaClass } from "./step-basics";

export function StepPlan({
  draft,
  patch,
}: {
  draft: WizardDraft;
  patch: (u: Partial<WizardDraft>) => void;
}) {
  // Expanded card is tracked by ID, not by index: deleting phase 0 while
  // phase 1 is open would otherwise leave "index 1" pointing at a different
  // phase and visually swap which card is expanded (defect R11).
  const [openId, setOpenId] = useState<string | null>(draft.phases[0]?.id ?? null);

  function updatePhase(id: string, updates: Partial<WizardDraft["phases"][number]>) {
    patch({ phases: draft.phases.map((p) => (p.id === id ? { ...p, ...updates } : p)) });
  }

  return (
    <div>
      <StepHeading
        title="Planung"
        hint="Arbeitsbereiche, erste Aufgaben, Meilensteine und der Budgetrahmen. Alles editierbar."
      />

      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="k-label" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
          Arbeitsbereiche (Phasen)
        </span>
        <button
          type="button"
          onClick={() => {
            const phase = {
              id: draftId(),
              name: "",
              description: "",
              startOffsetDays: 0,
              durationDays: 14,
              tasks: [],
            };
            patch({ phases: [...draft.phases, phase] });
            setOpenId(phase.id);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-muted"
        >
          <Plus className="h-[13px] w-[13px]" />
          Phase
        </button>
      </div>

      {draft.phases.length === 0 && (
        <p className="mb-3 text-[12px]" style={{ color: "var(--muted-foreground)" }}>
          Noch keine Phasen. Leg mindestens eine an — sie ist der Container für die Aufgaben.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {draft.phases.map((p, i) => {
          const expanded = openId === p.id;
          const start = offsetToISO(draft.startDate, p.startOffsetDays);
          // Inclusive end via the shared helper — a 14-day phase starting on
          // the 1st ends on the 14th, matching materializeProjectPlan (R7).
          const end = phaseEndISO(draft.startDate, p.startOffsetDays, p.durationDays);
          return (
            <div key={p.id} className="rounded-lg border border-border">
              <div className="flex items-center gap-2 p-2.5">
                <button
                  type="button"
                  onClick={() => setOpenId(expanded ? null : p.id)}
                  aria-label={expanded ? "Phase einklappen" : "Phase ausklappen"}
                  className="shrink-0"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <input
                  className={inputClass}
                  value={p.name}
                  onChange={(e) => updatePhase(p.id, { name: e.target.value })}
                  placeholder={`Phase ${i + 1}`}
                />
                <span
                  className="k-mono hidden shrink-0 text-[11px] sm:inline"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {formatDateDE(start)} – {formatDateDE(end)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (openId === p.id) setOpenId(null);
                    patch({
                      phases: draft.phases.filter((x) => x.id !== p.id),
                      // A milestone pointing at a deleted phase would be
                      // orphaned; detach it instead of leaving a dead id.
                      milestones: draft.milestones.map((m) =>
                        m.phaseId === p.id ? { ...m, phaseId: null } : m
                      ),
                    });
                  }}
                  aria-label="Phase entfernen"
                  className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="h-[14px] w-[14px]" />
                </button>
              </div>

              {expanded && (
                <div className="border-t border-border p-3">
                  <textarea
                    rows={2}
                    className={textareaClass}
                    value={p.description}
                    onChange={(e) => updatePhase(p.id, { description: e.target.value })}
                    placeholder="Beschreibung der Phase (optional)"
                  />

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {/* clampOffset/clampDuration, not `Number(x) || 0`: that
                        accepts -5 and produces a date before the project
                        start (defect R7). */}
                    <Field label="Start (Tage ab Projektstart)">
                      <input
                        type="number"
                        min={0}
                        className={inputClass}
                        value={p.startOffsetDays}
                        onChange={(e) => updatePhase(p.id, { startOffsetDays: clampOffset(e.target.value) })}
                      />
                    </Field>
                    <Field label="Dauer (Tage)">
                      <input
                        type="number"
                        min={1}
                        className={inputClass}
                        value={p.durationDays}
                        onChange={(e) => updatePhase(p.id, { durationDays: clampDuration(e.target.value) })}
                      />
                    </Field>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="k-label" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                      Aufgaben ({p.tasks.length})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updatePhase(p.id, {
                          tasks: [
                            ...p.tasks,
                            {
                              id: draftId(),
                              title: "",
                              description: "",
                              offsetDays: p.startOffsetDays,
                              priority: "mittel",
                            },
                          ],
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-muted"
                    >
                      <Plus className="h-[13px] w-[13px]" />
                      Aufgabe
                    </button>
                  </div>

                  <div className="mt-2 flex flex-col gap-2">
                    {p.tasks.map((tk) => (
                      <div key={tk.id} className="flex flex-wrap items-center gap-2">
                        <input
                          className={inputClass}
                          style={{ flex: "1 1 200px" }}
                          value={tk.title}
                          onChange={(e) =>
                            updatePhase(p.id, {
                              tasks: p.tasks.map((x) => (x.id === tk.id ? { ...x, title: e.target.value } : x)),
                            })
                          }
                          placeholder="Aufgabe"
                        />
                        <input
                          type="number"
                          min={0}
                          className={inputClass}
                          style={{ width: 92 }}
                          value={tk.offsetDays}
                          onChange={(e) =>
                            updatePhase(p.id, {
                              tasks: p.tasks.map((x) =>
                                x.id === tk.id ? { ...x, offsetDays: clampOffset(e.target.value) } : x
                              ),
                            })
                          }
                          title="Fällig in Tagen ab Projektstart"
                        />
                        <select
                          className={inputClass}
                          style={{ width: 120 }}
                          value={tk.priority}
                          onChange={(e) =>
                            updatePhase(p.id, {
                              tasks: p.tasks.map((x) => (x.id === tk.id ? { ...x, priority: e.target.value } : x)),
                            })
                          }
                          aria-label="Priorität"
                        >
                          {PRIORITIES.map((pr) => (
                            <option key={pr.value} value={pr.value}>
                              {pr.label}
                            </option>
                          ))}
                        </select>
                        <span className="k-mono text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                          {formatDateDE(offsetToISO(draft.startDate, tk.offsetDays))}
                        </span>
                        <button
                          type="button"
                          onClick={() => updatePhase(p.id, { tasks: p.tasks.filter((x) => x.id !== tk.id) })}
                          aria-label="Aufgabe entfernen"
                          className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:text-destructive"
                        >
                          <Trash2 className="h-[14px] w-[14px]" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="k-label" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
            Meilensteine
          </span>
          <button
            type="button"
            onClick={() =>
              patch({
                milestones: [...draft.milestones, { id: draftId(), name: "", phaseId: null, offsetDays: 30 }],
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-muted"
          >
            <Plus className="h-[13px] w-[13px]" />
            Meilenstein
          </button>
        </div>

        {draft.milestones.length === 0 && (
          <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            Noch keine Meilensteine. Sie sind bewusst unabhängig von Phasen.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {draft.milestones.map((m, i) => (
            <div key={m.id} className="flex flex-wrap items-center gap-2">
              <span
                className="k-mono inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px]"
                style={{ color: "var(--muted-foreground)" }}
              >
                {i + 1}
              </span>
              <input
                className={inputClass}
                style={{ flex: "1 1 200px" }}
                value={m.name}
                onChange={(e) =>
                  patch({
                    milestones: draft.milestones.map((x) =>
                      x.id === m.id ? { ...x, name: e.target.value } : x
                    ),
                  })
                }
                placeholder="z. B. Pilotphase abgeschlossen"
              />
              <select
                className={inputClass}
                style={{ width: 170 }}
                value={m.phaseId ?? ""}
                onChange={(e) =>
                  patch({
                    milestones: draft.milestones.map((x) =>
                      x.id === m.id ? { ...x, phaseId: e.target.value || null } : x
                    ),
                  })
                }
                aria-label="Phase"
              >
                <option value="">Ohne Phase</option>
                {draft.phases.map((ph, k) => (
                  <option key={ph.id} value={ph.id}>
                    {ph.name || `Phase ${k + 1}`}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                className={inputClass}
                style={{ width: 92 }}
                value={m.offsetDays}
                onChange={(e) =>
                  patch({
                    milestones: draft.milestones.map((x) =>
                      x.id === m.id ? { ...x, offsetDays: clampOffset(e.target.value) } : x
                    ),
                  })
                }
                title="Tage ab Projektstart"
              />
              <span className="k-mono text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                {formatDateDE(offsetToISO(draft.startDate, m.offsetDays))}
              </span>
              <button
                type="button"
                onClick={() => patch({ milestones: draft.milestones.filter((x) => x.id !== m.id) })}
                aria-label="Meilenstein entfernen"
                className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="h-[14px] w-[14px]" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="k-label mb-3" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
          Budget
        </div>
        <Field label="Budgetrahmen (EUR)" hint="Leer lassen, wenn das Projekt kein Budget hat.">
          <input
            type="number"
            min="0"
            className={inputClass}
            style={{ maxWidth: 200 }}
            value={draft.budgetPlannedEuros}
            onChange={(e) => patch({ budgetPlannedEuros: e.target.value })}
            placeholder="z. B. 5000"
          />
        </Field>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="k-label" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
            Aufschlüsselung (Plan)
          </span>
          <button
            type="button"
            onClick={() =>
              patch({ budgetEntries: [...draft.budgetEntries, { id: draftId(), label: "", amountEuros: "" }] })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-muted"
          >
            <Plus className="h-[13px] w-[13px]" />
            Position
          </button>
        </div>
        <div className="mt-2 flex flex-col gap-2">
          {draft.budgetEntries.map((b) => (
            <div key={b.id} className="flex items-center gap-2">
              <input
                className={inputClass}
                value={b.label}
                onChange={(e) =>
                  patch({
                    budgetEntries: draft.budgetEntries.map((x) =>
                      x.id === b.id ? { ...x, label: e.target.value } : x
                    ),
                  })
                }
                placeholder="z. B. Agenturkosten"
              />
              <input
                type="number"
                min="0"
                className={inputClass}
                style={{ width: 130 }}
                value={b.amountEuros}
                onChange={(e) =>
                  patch({
                    budgetEntries: draft.budgetEntries.map((x) =>
                      x.id === b.id ? { ...x, amountEuros: e.target.value } : x
                    ),
                  })
                }
                placeholder="EUR"
              />
              <button
                type="button"
                onClick={() => patch({ budgetEntries: draft.budgetEntries.filter((x) => x.id !== b.id) })}
                aria-label="Position entfernen"
                className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="h-[14px] w-[14px]" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
