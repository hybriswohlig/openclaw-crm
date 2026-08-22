"use client";

// Overlapping avatar row, overlap -6 px exactly as home/page.tsx:909-924.
// Anything beyond `max` collapses into a "+n" bubble whose title lists the
// hidden names, so nothing is lost on hover.
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { avatarOverflow } from "@/lib/work-ui";
import { cn } from "@/lib/utils";

export interface StackPerson {
  id: string;
  name: string;
  image?: string | null;
}

const BUBBLE_SIZE: Record<"xs" | "sm" | "md", string> = {
  xs: "h-6 w-6 text-[9px]",
  sm: "h-8 w-8 text-[10px]",
  md: "h-10 w-10 text-[11px]",
};

export function AvatarStack({
  people,
  max = 3,
  size = "xs",
  className,
}: {
  people: StackPerson[];
  max?: number;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const hidden = avatarOverflow(people.length, max);

  return (
    <div className={cn("inline-flex items-center", className)}>
      {shown.map((p, i) => (
        <div key={p.id} style={{ marginLeft: i === 0 ? 0 : -6 }}>
          <EmployeeAvatar name={p.name} photoBase64={p.image ?? null} size={size} />
        </div>
      ))}
      {hidden > 0 && (
        <div
          style={{ marginLeft: -6 }}
          title={people
            .slice(max)
            .map((p) => p.name)
            .join(", ")}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-muted font-medium text-muted-foreground ring-1 ring-border/50",
            BUBBLE_SIZE[size]
          )}
        >
          +{hidden}
        </div>
      )}
    </div>
  );
}
