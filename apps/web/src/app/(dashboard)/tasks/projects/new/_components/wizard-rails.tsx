"use client";

// The two right-hand rails of Mockup 3. The preview mirrors the draft live;
// the "Was passiert als Nächstes?" rail explains what the current step will
// produce, so the wizard never feels like a blind form.
import type { WizardDraft } from "./wizard-types";
import { ProjectIcon } from "@/components/work/project-icon";
import { ProgressBar } from "@/components/work/progress-bar";
import { StatusChip } from "@/components/work/status-chip";
import { projectCategoryLabel } from "@/lib/project-constants";
import { priorityMeta } from "@/lib/task-priority";
import { formatDateDE } from "@/lib/work-ui";

export function ProjectPreviewRail({ draft }: { draft: WizardDraft }) {
  const taskCount = draft.phases.reduce((n, p) => n + p.tasks.length, 0);
  const prio = priorityMeta(draft.priority);
  return (
    <div className="k-card p-4">
      <div className="k-label mb-3" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
        Projektvorschau
      </div>
      <div className="flex items-start gap-3">
        <ProjectIcon
          category={draft.category || null}
          name={draft.name || "Neues Projekt"}
          size={40}
        />
        <div className="min-w-0">
          <div className="truncate text-[14.5px] font-medium" style={{ color: "var(--foreground)" }}>
            {draft.name || "Neues Projekt"}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
            {draft.shortDescription || "Noch keine Kurzbeschreibung."}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {draft.category && <StatusChip tone="info">{projectCategoryLabel(draft.category)}</StatusChip>}
        {prio && (
          <StatusChip>
            <span className="h-[6px] w-[6px] rounded-full" style={{ background: prio.dot }} />
            {prio.label}
          </StatusChip>
        )}
      </div>

      <dl className="mt-3 flex flex-col gap-1.5 text-[12.5px]">
        <PreviewRow label="Laufzeit" value={`${formatDateDE(draft.startDate)} – ${formatDateDE(draft.endDate)}`} />
        <PreviewRow label="Phasen" value={String(draft.phases.length)} />
        <PreviewRow label="Aufgaben" value={String(taskCount)} />
        <PreviewRow label="Meilensteine" value={String(draft.milestones.length)} />
        <PreviewRow label="Risiken" value={String(draft.risks.length)} />
        <PreviewRow label="Team" value={String(draft.members.length)} />
        <PreviewRow
          label="Budget"
          value={draft.budgetPlannedEuros ? `${draft.budgetPlannedEuros} €` : "kein Rahmen"}
        />
      </dl>

      <div className="mt-3">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="k-label" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
            Vollständigkeit
          </span>
          <span className="k-mono text-[11px]" style={{ color: "var(--muted-foreground)" }}>
            Schritt {draft.step}/5
          </span>
        </div>
        <ProgressBar value={(draft.step / 5) * 100} height={5} />
      </div>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt style={{ color: "var(--muted-foreground)" }}>{label}</dt>
      <dd className="truncate text-right" style={{ color: "var(--foreground)" }}>
        {value}
      </dd>
    </div>
  );
}

const NEXT_STEPS: Record<number, string[]> = {
  1: [
    "Wir schlagen dir aus diesen Angaben Scope-Punkte und erste Risiken vor.",
    "Nichts wird gespeichert, bevor du auf „Projekt erstellen“ klickst.",
    "Dein Entwurf bleibt erhalten, auch wenn du den Tab schliesst.",
  ],
  2: [
    "Der Scope trennt „gehört dazu“ von „ausdrücklich nicht“ — das erspart später Diskussionen.",
    "Risiken kannst du jederzeit im Projekt unter „Risiken“ nachpflegen.",
  ],
  3: [
    "Phasen sind Arbeitsbereiche; jede Aufgabe darin wird beim Anlegen als Projektaufgabe erzeugt.",
    "Alle Datumsangaben sind Tage ab Projektstart und werden beim Anlegen in echte Daten umgerechnet.",
    "Der Budgetrahmen ist der Nenner der Budget-Kachel; Ist-Buchungen kommen später dazu.",
  ],
  4: [
    "Der Projektleiter wird automatisch als Mitglied mit der Rolle „Leiter“ eingetragen.",
    "Ein Sprint hier ordnet die Aufgaben des ersten Arbeitsbereichs direkt zu.",
  ],
  5: [
    "„Projekt erstellen“ legt Projekt, Team, Phasen, Aufgaben, Meilensteine, Risiken und Budgetzeilen in einem Rutsch an.",
    "Danach landest du direkt auf der Projektseite.",
  ],
};

export function NextStepsRail({ step }: { step: number }) {
  return (
    <div className="k-card p-4">
      <div className="k-label mb-2" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
        Was passiert als Nächstes?
      </div>
      <ul className="flex flex-col gap-2">
        {(NEXT_STEPS[step] ?? []).map((t, i) => (
          <li key={i} className="flex gap-2 text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
            <span
              className="mt-[6px] h-[5px] w-[5px] shrink-0 rounded-full"
              style={{ background: "var(--kottke-accent)" }}
            />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}
