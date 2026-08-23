"use client";

import type { Tone } from "@/lib/work-ui";
import {
  projectStatusLabel,
  taskStatusLabel,
} from "@/lib/project-constants";
import { cn } from "@/lib/utils";

const TONE_VAR: Record<Exclude<Tone, "neutral">, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  info: "var(--info)",
  accent: "var(--kottke-accent)",
};

export function StatusChip({
  tone = "neutral",
  children,
  dot = false,
  className,
  title,
}: {
  tone?: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
  title?: string;
}) {
  const base =
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-[3px] text-[11.5px] font-medium leading-none";

  if (tone === "neutral") {
    return (
      <span
        title={title}
        className={cn(base, "border-border bg-muted text-muted-foreground", className)}
      >
        {dot && <span className="h-[6px] w-[6px] rounded-full bg-current" />}
        {children}
      </span>
    );
  }

  const c = TONE_VAR[tone];
  return (
    <span
      title={title}
      className={cn(base, className)}
      style={{
        background: `color-mix(in oklch, ${c} 14%, transparent)`,
        borderColor: `color-mix(in oklch, ${c} 38%, transparent)`,
        color: c,
      }}
    >
      {dot && <span className="h-[6px] w-[6px] rounded-full bg-current" />}
      {children}
    </span>
  );
}

const PROJECT_TONE: Record<string, Tone> = {
  geplant: "info",
  aktiv: "accent",
  pausiert: "warn",
  abgeschlossen: "ok",
  abgebrochen: "danger",
};

export function ProjectStatusChip({ status }: { status: string }) {
  return (
    <StatusChip tone={PROJECT_TONE[status] ?? "neutral"} dot>
      {projectStatusLabel(status) || status}
    </StatusChip>
  );
}

const TASK_TONE: Record<string, Tone> = {
  geplant: "neutral",
  in_arbeit: "accent",
  erledigt: "ok",
};

export function TaskStatusChip({ status }: { status: string }) {
  return <StatusChip tone={TASK_TONE[status] ?? "neutral"}>{taskStatusLabel(status) || status}</StatusChip>;
}

const PHASE_LABEL: Record<string, string> = {
  geplant: "Geplant",
  in_arbeit: "In Arbeit",
  abgeschlossen: "Abgeschlossen",
};
const PHASE_TONE: Record<string, Tone> = {
  geplant: "neutral",
  in_arbeit: "accent",
  abgeschlossen: "ok",
};

export function PhaseStatusChip({ status }: { status: string }) {
  return <StatusChip tone={PHASE_TONE[status] ?? "neutral"}>{PHASE_LABEL[status] ?? status}</StatusChip>;
}

const MILESTONE_LABEL: Record<string, string> = {
  geplant: "Geplant",
  erreicht: "Erreicht",
  verfehlt: "Verfehlt",
};
const MILESTONE_TONE: Record<string, Tone> = {
  geplant: "neutral",
  erreicht: "ok",
  verfehlt: "danger",
};

export function MilestoneStatusChip({ status }: { status: string }) {
  return <StatusChip tone={MILESTONE_TONE[status] ?? "neutral"}>{MILESTONE_LABEL[status] ?? status}</StatusChip>;
}

const SEVERITY_LABEL: Record<string, string> = {
  niedrig: "Niedrig",
  mittel: "Mittel",
  hoch: "Hoch",
};
const SEVERITY_TONE: Record<string, Tone> = {
  niedrig: "info",
  mittel: "warn",
  hoch: "danger",
};

export function RiskChip({ severity }: { severity: string }) {
  return (
    <StatusChip tone={SEVERITY_TONE[severity] ?? "neutral"} dot>
      {SEVERITY_LABEL[severity] ?? severity}
    </StatusChip>
  );
}

const RISK_STATUS_LABEL: Record<string, string> = {
  offen: "Offen",
  beobachtet: "Beobachtet",
  geschlossen: "Geschlossen",
};
const RISK_STATUS_TONE: Record<string, Tone> = {
  offen: "danger",
  beobachtet: "warn",
  geschlossen: "ok",
};

export function RiskStatusChip({ status }: { status: string }) {
  return <StatusChip tone={RISK_STATUS_TONE[status] ?? "neutral"}>{RISK_STATUS_LABEL[status] ?? status}</StatusChip>;
}
