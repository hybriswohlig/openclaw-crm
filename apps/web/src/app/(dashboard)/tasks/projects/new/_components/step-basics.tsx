"use client";

// Wizard step 1 — exactly the fields of Mockup 3: name*, short description*,
// area*, priority* (four buttons), planned duration, project lead*, plus the
// "Geschäftlicher Hintergrund" and "Projektumfang (grob)" blocks.
import { useEffect, useState } from "react";
import { PROJECT_CATEGORIES } from "@/lib/project-constants";
import { PRIORITIES } from "@/lib/task-priority";
import type { WizardDraft } from "./wizard-types";
import { cn } from "@/lib/utils";

interface Member {
  userId: string;
  name: string;
  email: string;
}

export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium" style={{ color: "var(--foreground)" }}>
        {label}
        {required && <span style={{ color: "var(--danger)" }}> *</span>}
      </span>
      {children}
      {hint && (
        <span className="text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

export const inputClass =
  "h-9 w-full rounded-lg border border-border bg-background px-3 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/25";
export const textareaClass =
  "w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/25";

export function StepHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-4">
      <h2 className="k-display m-0" style={{ fontSize: 20, fontWeight: 500 }}>
        {title}
      </h2>
      <p className="mt-1 text-[13px]" style={{ color: "var(--muted-foreground)" }}>
        {hint}
      </p>
    </div>
  );
}

export function StepBasics({
  draft,
  patch,
}: {
  draft: WizardDraft;
  patch: (u: Partial<WizardDraft>) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);

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
  }, []);

  return (
    <div>
      <StepHeading
        title="Grundlagen"
        hint="Was ist das Projekt, wem gehört es, und wie dringend ist es?"
      />

      <div className="flex flex-col gap-4">
        <Field label="Projektname" required>
          <input
            className={inputClass}
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="z. B. Website-Relaunch kottke-umzuege.de"
          />
        </Field>

        <Field label="Kurzbeschreibung" required hint="Ein Satz, der auf der Projektkarte steht.">
          <input
            className={inputClass}
            value={draft.shortDescription}
            onChange={(e) => patch({ shortDescription: e.target.value })}
            placeholder="z. B. Neue Website mit Leistungsseiten, SEO und Formularen"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Projektbereich" required>
            <select
              className={inputClass}
              value={draft.category}
              onChange={(e) => patch({ category: e.target.value })}
            >
              <option value="">Bereich wählen</option>
              {PROJECT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Verantwortlicher Projektleiter" required>
            <select
              className={inputClass}
              value={draft.ownerUserId}
              onChange={(e) => patch({ ownerUserId: e.target.value })}
            >
              <option value="">Person wählen</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name || m.email}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Priorität" required>
          <div className="flex flex-wrap gap-2">
            {PRIORITIES.map((p) => {
              const active = draft.priority === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => patch({ priority: p.value })}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors",
                    active
                      ? "border-transparent bg-foreground text-background"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: p.dot }} />
                  {p.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Geplante Laufzeit">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              className={cn(inputClass, "max-w-[180px]")}
              value={draft.startDate}
              onChange={(e) => patch({ startDate: e.target.value })}
            />
            <span style={{ color: "var(--muted-foreground)" }}>bis</span>
            <input
              type="date"
              className={cn(inputClass, "max-w-[180px]")}
              value={draft.endDate}
              onChange={(e) => patch({ endDate: e.target.value })}
            />
          </div>
        </Field>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="k-label mb-3" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
          Geschäftlicher Hintergrund
        </div>
        <div className="flex flex-col gap-4">
          <Field label="Ausgangssituation / Problem">
            <textarea
              rows={3}
              className={textareaClass}
              value={draft.problemStatement}
              onChange={(e) => patch({ problemStatement: e.target.value })}
              placeholder="Was läuft heute schlecht oder fehlt?"
            />
          </Field>
          <Field label="Ziel des Projekts">
            <textarea
              rows={3}
              className={textareaClass}
              value={draft.goalStatement}
              onChange={(e) => patch({ goalStatement: e.target.value })}
              placeholder="Was soll danach anders sein?"
            />
          </Field>
          <Field label="Erfolgskriterien">
            <textarea
              rows={2}
              className={textareaClass}
              value={draft.successCriteria}
              onChange={(e) => patch({ successCriteria: e.target.value })}
              placeholder="Woran erkennst du, dass es geklappt hat?"
            />
          </Field>
        </div>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="k-label mb-3" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
          Projektumfang (grob)
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Im Projekt enthalten" hint="Je Zeile ein Punkt.">
            <textarea
              rows={5}
              className={textareaClass}
              value={draft.scopeIn.join("\n")}
              onChange={(e) => patch({ scopeIn: splitLines(e.target.value) })}
              placeholder={"Leistungsseiten\nSEO-Grundlagen\nKontaktformulare"}
            />
          </Field>
          <Field label="Nicht im Projekt enthalten" hint="Je Zeile ein Punkt.">
            <textarea
              rows={5}
              className={textareaClass}
              value={draft.scopeOut.join("\n")}
              onChange={(e) => patch({ scopeOut: splitLines(e.target.value) })}
              placeholder={"Shop-Funktion\nEnglische Version"}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

/** Textarea → string[]: keep the user's order, drop blank lines. */
export function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
