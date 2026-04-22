import { cn } from "@/lib/utils";

interface EmployeeAvatarProps {
  name: string;
  photoBase64?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<EmployeeAvatarProps["size"]>, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
  xl: "h-20 w-20 text-lg",
};

// Stable color from name so each employee has their own consistent badge color.
const PALETTE = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-fuchsia-500",
  "bg-pink-500",
];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function EmployeeAvatar({ name, photoBase64, size = "md", className }: EmployeeAvatarProps) {
  const sizeClass = SIZE_CLASS[size];

  if (photoBase64) {
    return (
      <img
        src={photoBase64}
        alt={name}
        title={name}
        className={cn(
          "shrink-0 rounded-full object-cover ring-1 ring-border",
          sizeClass,
          className
        )}
      />
    );
  }

  return (
    <div
      title={name}
      className={cn(
        "shrink-0 inline-flex items-center justify-center rounded-full font-medium text-white ring-1 ring-border/50",
        sizeClass,
        colorForName(name),
        className
      )}
    >
      {initials(name)}
    </div>
  );
}
