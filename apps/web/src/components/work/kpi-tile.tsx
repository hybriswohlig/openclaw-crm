"use client";

// KPI tile, structure from statistics/page.tsx:217-279 (label over a large
// k-display number), extended with the progress bar and the optional link
// affordance from home/page.tsx WichtigTile. The row uses the house grid
// `repeat(auto-fit, minmax(200px, 1fr))`.
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ProgressBar } from "./progress-bar";
import type { Tone } from "@/lib/work-ui";
import { cn } from "@/lib/utils";

const VALUE_TONE: Record<Tone, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  info: "var(--info)",
  accent: "var(--kottke-accent)",
  neutral: "var(--foreground)",
};

export function KpiGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn("grid gap-3", className)}
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
    >
      {children}
    </div>
  );
}

export function KpiTile({
  label,
  value,
  sub,
  tone = "neutral",
  progress,
  icon,
  href,
}: {
  label: string;
  value: string;
  sub?: string | null;
  tone?: Tone;
  progress?: number | null;
  icon?: React.ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div
          className="k-label"
          style={{ fontSize: 10.5, color: "var(--muted-foreground)", letterSpacing: "0.1em" }}
        >
          {label}
        </div>
        {icon && <span style={{ color: "var(--muted-foreground)" }}>{icon}</span>}
      </div>
      <div
        className="k-display"
        style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em", color: VALUE_TONE[tone], lineHeight: 1.1 }}
      >
        {value}
      </div>
      {progress != null && <ProgressBar value={progress} tone={tone === "neutral" ? "accent" : tone} />}
      {sub && (
        <div className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
          {sub}
        </div>
      )}
    </>
  );

  const shell =
    "k-card flex min-h-[104px] flex-col justify-between gap-2 p-4 transition-colors";

  if (href) {
    return (
      <Link href={href} className={cn(shell, "group hover:border-foreground/20")}>
        {body}
        <span className="sr-only">
          <ArrowRight />
        </span>
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}
