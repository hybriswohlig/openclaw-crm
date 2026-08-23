"use client";

// Wizard step 4 — members with roles and the sprint the first tasks go into.
// The project lead is always a member with role "leiter" (Spec §4.4), so the
// row is rendered but its role is fixed.
import { useEffect, useState } from "react";
import { PROJECT_MEMBER_ROLE } from "@/lib/project-constants";
import type { SprintJSON } from "@/lib/work-types";
import { formatSprintRangeDE } from "@/lib/work-ui";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import type { WizardDraft } from "./wizard-types";
import { Field, StepHeading, inputClass } from "./step-basics";

interface Member {
  userId: string;
  name: string;
  email: string;
}

const ROLE_LABEL: Record<string, string> = {
  leiter: "Leiter",
  mitglied: "Mitglied",
  beobachter: "Beobachter",
};

export function StepTeam({
  draft,
  patch,
}: {
  draft: WizardDraft;
  patch: (u: Partial<WizardDraft>) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [sprints, setSprints] = useState<SprintJSON[]>([]);

  useEffect(() => {
    fetch("/api/v1/workspace-members", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) =>
        setMembers(
          ((json?.data ?? []) as Array<{ userId: string; userName?: string; userEmail?: string }>).map((m) => ({
            userId: m.userId,
            name: m.userName ?? "",
            email: m.userEmail ?? "",
          }))
        )
      )
      .catch(() => {});
    fetch("/api/v1/sprints", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) =>
        setSprints(
          ((json?.data?.sprints ?? []) as SprintJSON[]).filter(
            (s) => s.state === "aktiv" || s.state === "planung"
          )
        )
      )
      .catch(() => {});
  }, []);

  function roleOf(userId: string): string | null {
    if (userId === draft.ownerUserId) return "leiter";
    return draft.members.find((m) => m.userId === userId)?.role ?? null;
  }

  function setRole(userId: string, role: string | null) {
    if (userId === draft.ownerUserId) return; // the lead is fixed
    const without = draft.members.filter((m) => m.userId !== userId);
    patch({ members: role ? [...without, { userId, role }] : without });
  }

  const taskCount = draft.phases.reduce((n, p) => n + p.tasks.length, 0);

  return (
    <div>
      <StepHeading
        title="Team & Ressourcen"
        hint="Wer arbeitet mit, und in welchem Sprint startet die erste Arbeit?"
      />

      <div className="k-label mb-2" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
        Mitglieder
      </div>
      <div className="flex flex-col gap-2">
        {members.length === 0 && (
          <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            Keine Workspace-Mitglieder gefunden.
          </p>
        )}
        {members.map((m) => {
          const role = roleOf(m.userId);
          const isOwner = m.userId === draft.ownerUserId;
          return (
            <div key={m.userId} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
              <EmployeeAvatar name={m.name || m.email} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px]" style={{ color: "var(--foreground)" }}>
                  {m.name || m.email}
                </div>
                <div className="truncate text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
                  {m.email}
                </div>
              </div>
              <select
                className={inputClass}
                style={{ width: 150 }}
                value={role ?? ""}
                disabled={isOwner}
                onChange={(e) => setRole(m.userId, e.target.value || null)}
                aria-label="Rolle"
              >
                <option value="">Nicht im Projekt</option>
                {PROJECT_MEMBER_ROLE.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              {isOwner && (
                <span className="k-mono shrink-0 text-[10.5px]" style={{ color: "var(--muted-foreground)" }}>
                  Projektleiter
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <Field
          label="Sprint für die ersten Aufgaben"
          hint={
            taskCount > 0
              ? `${taskCount} geplante Aufgaben werden diesem Sprint zugeordnet.`
              : "Noch keine Aufgaben geplant — der Sprint bleibt dann ohne Wirkung."
          }
        >
          <select
            className={inputClass}
            style={{ maxWidth: 320 }}
            value={draft.sprintId}
            onChange={(e) => patch({ sprintId: e.target.value })}
          >
            <option value="">Kein Sprint</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {formatSprintRangeDE(s.startDate, s.endDate)}
                {s.state === "aktiv" ? " (aktiv)" : " (Planung)"}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}
