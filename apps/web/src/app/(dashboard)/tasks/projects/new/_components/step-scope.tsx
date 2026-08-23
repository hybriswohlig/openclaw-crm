"use client";

// Wizard step 2 — the AI-refined scope points and first risks, all editable
// and removable (Spec §8.3 point 2).
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { RISK_SEVERITY } from "@/lib/project-constants";
import type { WizardDraft } from "./wizard-types";
import { draftId } from "./wizard-types";
import { Field, StepHeading, inputClass, textareaClass } from "./step-basics";
import { StatusChip } from "@/components/work/status-chip";

export function EditableList({
  items,
  onChange,
  placeholder,
  emptyHint,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  emptyHint: string;
}) {
  const [pending, setPending] = useState("");

  function add() {
    const v = pending.trim();
    if (!v) return;
    onChange([...items, v]);
    setPending("");
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.length === 0 && (
        <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
          {emptyHint}
        </p>
      )}
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={inputClass}
            value={item}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            aria-label="Punkt entfernen"
            className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:text-destructive"
          >
            <Trash2 className="h-[14px] w-[14px]" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          className={inputClass}
          value={pending}
          onChange={(e) => setPending(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={add}
          aria-label="Punkt hinzufügen"
          className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-muted"
        >
          <Plus className="h-[14px] w-[14px]" />
        </button>
      </div>
    </div>
  );
}

export function StepScope({
  draft,
  patch,
}: {
  draft: WizardDraft;
  patch: (u: Partial<WizardDraft>) => void;
}) {
  return (
    <div>
      <StepHeading
        title="Ziel & Scope"
        hint="Was gehört dazu, was ausdrücklich nicht — und was kann schiefgehen?"
      />

      <div className="flex flex-col gap-5">
        <Field label="Ziel des Projekts">
          <textarea
            rows={3}
            className={textareaClass}
            value={draft.goalStatement}
            onChange={(e) => patch({ goalStatement: e.target.value })}
            placeholder="Was soll danach anders sein?"
          />
        </Field>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="k-label" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
              Im Projekt enthalten
            </span>
            <StatusChip tone="ok">{draft.scopeIn.length}</StatusChip>
          </div>
          <EditableList
            items={draft.scopeIn}
            onChange={(scopeIn) => patch({ scopeIn })}
            placeholder="Punkt ergänzen und Enter drücken"
            emptyHint="Noch keine Punkte. Trage ein, was das Projekt liefert."
          />
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="k-label" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
              Nicht im Projekt enthalten
            </span>
            <StatusChip tone="danger">{draft.scopeOut.length}</StatusChip>
          </div>
          <EditableList
            items={draft.scopeOut}
            onChange={(scopeOut) => patch({ scopeOut })}
            placeholder="Ausschluss ergänzen und Enter drücken"
            emptyHint="Noch keine Ausschlüsse. Was ausdrücklich nicht dazugehört, spart später Streit."
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="k-label" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
              Erst-Risiken
            </span>
            <button
              type="button"
              onClick={() =>
                patch({
                  risks: [
                    ...draft.risks,
                    { id: draftId(), title: "", description: "", severity: "mittel", mitigation: "" },
                  ],
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-muted"
            >
              <Plus className="h-[13px] w-[13px]" />
              Risiko
            </button>
          </div>

          {draft.risks.length === 0 && (
            <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
              Noch keine Risiken erfasst.
            </p>
          )}

          <div className="flex flex-col gap-3">
            {draft.risks.map((r) => (
              <div key={r.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    value={r.title}
                    onChange={(e) =>
                      patch({ risks: draft.risks.map((x) => (x.id === r.id ? { ...x, title: e.target.value } : x)) })
                    }
                    placeholder="Risiko in einem Satz"
                  />
                  <select
                    className={inputClass}
                    style={{ maxWidth: 120 }}
                    value={r.severity}
                    onChange={(e) =>
                      patch({ risks: draft.risks.map((x) => (x.id === r.id ? { ...x, severity: e.target.value } : x)) })
                    }
                    aria-label="Schwere"
                  >
                    {RISK_SEVERITY.map((s) => (
                      <option key={s} value={s}>
                        {s === "niedrig" ? "Niedrig" : s === "mittel" ? "Mittel" : "Hoch"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => patch({ risks: draft.risks.filter((x) => x.id !== r.id) })}
                    aria-label="Risiko entfernen"
                    className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="h-[14px] w-[14px]" />
                  </button>
                </div>
                <textarea
                  rows={2}
                  className={`${textareaClass} mt-2`}
                  value={r.mitigation}
                  onChange={(e) =>
                    patch({ risks: draft.risks.map((x) => (x.id === r.id ? { ...x, mitigation: e.target.value } : x)) })
                  }
                  placeholder="Gegenmassnahme (optional)"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
