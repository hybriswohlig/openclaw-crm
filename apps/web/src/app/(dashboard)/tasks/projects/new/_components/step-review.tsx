"use client";

// Wizard step 5 — a read-only summary of everything that is about to be
// written in one transaction.
import type { WizardDraft } from "./wizard-types";
import { offsetToISO, phaseEndISO } from "./wizard-types";
import { StepHeading } from "./step-basics";
import { projectCategoryLabel } from "@/lib/project-constants";
import { priorityMeta } from "@/lib/task-priority";
import { formatDateDE } from "@/lib/work-ui";
import { StatusChip } from "@/components/work/status-chip";

export function StepReview({ draft }: { draft: WizardDraft }) {
  const taskCount = draft.phases.reduce((n, p) => n + p.tasks.length, 0);
  return (
    <div>
      <StepHeading
        title="Überprüfung"
        hint="Ein letzter Blick. Mit „Projekt erstellen“ wird alles in einem Rutsch angelegt."
      />

      <Block title="Grunddaten">
        <Row label="Name" value={draft.name || "–"} />
        <Row label="Kurzbeschreibung" value={draft.shortDescription || "–"} />
        <Row label="Bereich" value={projectCategoryLabel(draft.category) || "–"} />
        <Row label="Priorität" value={priorityMeta(draft.priority)?.label ?? "–"} />
        <Row label="Laufzeit" value={`${formatDateDE(draft.startDate)} – ${formatDateDE(draft.endDate)}`} />
        <Row
          label="Budgetrahmen"
          value={draft.budgetPlannedEuros ? `${draft.budgetPlannedEuros} €` : "kein Budget"}
        />
      </Block>

      <Block title={`Scope (${draft.scopeIn.length} enthalten, ${draft.scopeOut.length} ausgeschlossen)`}>
        <div className="flex flex-wrap gap-1.5">
          {draft.scopeIn.map((s, i) => (
            <StatusChip key={`in-${i}-${s}`} tone="ok">
              {s}
            </StatusChip>
          ))}
          {draft.scopeOut.map((s, i) => (
            <StatusChip key={`out-${i}-${s}`} tone="danger">
              {s}
            </StatusChip>
          ))}
          {draft.scopeIn.length === 0 && draft.scopeOut.length === 0 && (
            <span className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
              Kein Scope erfasst.
            </span>
          )}
        </div>
      </Block>

      <Block title={`Plan (${draft.phases.length} Phasen, ${taskCount} Aufgaben)`}>
        {draft.phases.length === 0 && (
          <span className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
            Keine Phasen geplant.
          </span>
        )}
        {draft.phases.map((p, i) => (
          <div key={p.id} className="mb-2">
            <div className="text-[13px] font-medium" style={{ color: "var(--foreground)" }}>
              {p.name || `Phase ${i + 1}`}
              <span className="k-mono ml-2 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                {formatDateDE(offsetToISO(draft.startDate, p.startOffsetDays))} –{" "}
                {formatDateDE(phaseEndISO(draft.startDate, p.startOffsetDays, p.durationDays))}
              </span>
            </div>
            <ul className="mt-1 flex flex-col gap-0.5 pl-3">
              {p.tasks.map((tk) => (
                <li key={tk.id} className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
                  · {tk.title || "(ohne Titel)"} — {formatDateDE(offsetToISO(draft.startDate, tk.offsetDays))}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Block>

      <Block title={`Meilensteine (${draft.milestones.length})`}>
        {draft.milestones.length === 0 ? (
          <span className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
            Keine Meilensteine.
          </span>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {draft.milestones.map((m, i) => (
              <li key={m.id} className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
                {i + 1}. {m.name || "(ohne Titel)"} — {formatDateDE(offsetToISO(draft.startDate, m.offsetDays))}
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={`Risiken (${draft.risks.length})`}>
        {draft.risks.length === 0 ? (
          <span className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
            Keine Risiken erfasst.
          </span>
        ) : (
          <ul className="flex flex-col gap-1">
            {draft.risks.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-[12.5px]">
                <StatusChip tone={r.severity === "hoch" ? "danger" : r.severity === "mittel" ? "warn" : "info"}>
                  {r.severity}
                </StatusChip>
                <span style={{ color: "var(--muted-foreground)" }}>{r.title || "(ohne Titel)"}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={`Team (${draft.members.length + (draft.ownerUserId ? 1 : 0)})`}>
        <span className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
          Projektleiter plus {draft.members.length} weitere{draft.members.length === 1 ? "s Mitglied" : " Mitglieder"}.
          {draft.sprintId ? " Erste Aufgaben gehen in den gewählten Sprint." : " Ohne Sprintzuordnung."}
        </span>
      </Block>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-lg border border-border p-3">
      <div className="k-label mb-2" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
        {title}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[12.5px]">
      <span style={{ color: "var(--muted-foreground)" }}>{label}</span>
      <span className="text-right" style={{ color: "var(--foreground)" }}>
        {value}
      </span>
    </div>
  );
}
