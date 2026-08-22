"use client";

// The project icon tile. Icon and colour are both optional on a project
// (Spec §8): the icon falls back to a per-category lucide icon, the colour
// to a deterministic hash of the project name. The icon set is written out
// explicitly instead of `import * as lucide` so the bundle only carries the
// 14 icons the module can actually show.
import {
  Wrench,
  Handshake,
  Megaphone,
  Users,
  Truck,
  MapPin,
  Building2,
  ListChecks,
  Network,
  Tag,
  Star,
  Cpu,
  Wallet,
  Folder,
  type LucideIcon,
} from "lucide-react";
import { defaultProjectIcon, defaultProjectColor } from "@/lib/project-constants";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  Wrench,
  Handshake,
  Megaphone,
  Users,
  Truck,
  MapPin,
  Building2,
  ListChecks,
  Network,
  Tag,
  Star,
  Cpu,
  Wallet,
  Folder,
};

export function projectIconComponent(name: string | null | undefined): LucideIcon {
  return (name && ICONS[name]) || Folder;
}

export function ProjectIcon({
  icon,
  category,
  name,
  color,
  size = 40,
  className,
}: {
  icon?: string | null;
  category?: string | null;
  name: string;
  color?: string | null;
  size?: number;
  className?: string;
}) {
  const Icon = projectIconComponent(icon ?? defaultProjectIcon(category ?? null));
  const tint = color ?? defaultProjectColor(category ?? null, name);
  const glyph = Math.round(size * 0.45);

  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        // color-mix keeps the tile legible on both the warm paper and the
        // dark card background — a flat hex would not.
        background: `color-mix(in srgb, ${tint} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tint} 32%, transparent)`,
        color: tint,
      }}
      aria-hidden
    >
      <Icon style={{ width: glyph, height: glyph }} />
    </span>
  );
}
