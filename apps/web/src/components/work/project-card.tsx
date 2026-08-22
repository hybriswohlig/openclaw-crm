"use client";

// The project card from Mockup 1: icon tile, name, short description,
// progress bar, the three numbers (Aufgaben / Erledigt / Überfällig),
// the avatar stack and the "Öffnen →" affordance.
import Link from "next/link";
import { Star, Plus } from "lucide-react";
import type { ProjectJSON } from "@/lib/work-types";
import { ProjectIcon } from "./project-icon";
import { ProgressBar } from "./progress-bar";
import { AvatarStack } from "./avatar-stack";
import { ProjectStatusChip } from "./status-chip";
import { cn } from "@/lib/utils";

export function ProjectCard({
  project,
  onToggleFavorite,
}: {
  project: ProjectJSON;
  onToggleFavorite?: (id: string, next: boolean) => void;
}) {
  const s = project.stats;
  return (
    <div className="k-card flex flex-col gap-3 p-4 transition-colors hover:border-foreground/20">
      <div className="flex items-start gap-3">
        <ProjectIcon
          icon={project.icon}
          category={project.category}
          name={project.name}
          color={project.color}
          size={40}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <Link
              href={`/tasks/projects/${project.id}`}
              className="min-w-0 flex-1 truncate text-[14.5px] font-medium hover:underline"
              style={{ color: "var(--foreground)" }}
            >
              {project.name}
            </Link>
            {onToggleFavorite && (
              <button
                type="button"
                onClick={() => onToggleFavorite(project.id, !project.isFavorite)}
                aria-label={project.isFavorite ? "Favorit entfernen" : "Als Favorit markieren"}
                className="shrink-0"
              >
                <Star
                  className="h-4 w-4"
                  style={{
                    color: project.isFavorite ? "var(--warn)" : "var(--muted-foreground)",
                    fill: project.isFavorite ? "var(--warn)" : "none",
                  }}
                />
              </button>
            )}
          </div>
          {project.shortDescription && (
            <p className="mt-0.5 line-clamp-2 text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
              {project.shortDescription}
            </p>
          )}
        </div>
      </div>

      {/* A fully planned project with 0 tasks would otherwise read "0 %" and
          "0 von 0 Aufgaben", pixel-identical to a stalled one. Fall back to
          phase progress, which the stats already carry (defect W12). */}
      {s.totalTasks === 0 && s.totalPhases > 0 ? (
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="k-label" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
              Phasen
            </span>
            <span className="k-mono text-[11.5px] tabular-nums" style={{ color: "var(--foreground)" }}>
              {s.donePhases}/{s.totalPhases}
            </span>
          </div>
          <ProgressBar value={(s.donePhases / s.totalPhases) * 100} tone="info" />
        </div>
      ) : s.totalTasks === 0 ? (
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="k-label" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
              Fortschritt
            </span>
            <span className="k-mono text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
              noch nichts geplant
            </span>
          </div>
          <ProgressBar value={0} tone="neutral" />
        </div>
      ) : (
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="k-label" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
              Fortschritt
            </span>
            <span className="k-mono text-[11.5px] tabular-nums" style={{ color: "var(--foreground)" }}>
              {s.progressPct} %
            </span>
          </div>
          <ProgressBar value={s.progressPct} tone={s.overdueTasks > 0 ? "warn" : "accent"} />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 px-2 py-2 text-center">
        <Stat label="Aufgaben" value={s.totalTasks} />
        <Stat label="Erledigt" value={s.doneTasks} tone="var(--ok)" />
        <Stat label="Überfällig" value={s.overdueTasks} tone={s.overdueTasks > 0 ? "var(--danger)" : undefined} />
      </div>

      <div className="mt-auto flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AvatarStack people={project.members.map((m) => ({ id: m.userId, name: m.name, image: m.image }))} max={3} />
          <ProjectStatusChip status={project.status} />
        </div>
        <Link
          href={`/tasks/projects/${project.id}`}
          className="shrink-0 text-xs"
          style={{ color: "var(--kottke-accent)" }}
        >
          Öffnen →
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <div
        className="k-display tabular-nums"
        style={{ fontSize: 17, lineHeight: 1.1, color: tone ?? "var(--foreground)" }}
      >
        {value}
      </div>
      <div className="k-label" style={{ fontSize: 9.5, color: "var(--muted-foreground)" }}>
        {label}
      </div>
    </div>
  );
}

export function NewProjectTile({ href = "/tasks/projects/new", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-[188px] flex-col items-center justify-center gap-2 rounded-[18px] border border-dashed border-border p-4 text-center transition-colors hover:border-foreground/30 hover:bg-muted/40",
        className
      )}
    >
      <span
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl"
        style={{
          background: "color-mix(in oklch, var(--kottke-accent) 12%, transparent)",
          color: "var(--kottke-accent)",
        }}
      >
        <Plus className="h-5 w-5" />
      </span>
      <span className="text-[13.5px] font-medium" style={{ color: "var(--foreground)" }}>
        Neues Projekt hinzufügen
      </span>
      <span className="max-w-[24ch] text-[12px]" style={{ color: "var(--muted-foreground)" }}>
        Der Wizard schlägt dir Phasen, Meilensteine und Risiken vor.
      </span>
    </Link>
  );
}
