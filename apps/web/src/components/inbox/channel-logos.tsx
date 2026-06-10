// apps/web/src/components/inbox/channel-logos.tsx
//
// Brand channel marks + a person avatar that shows the LAST platform we wrote
// with the person on (WhatsApp / Kleinanzeigen / E-Mail). Replaces the
// initials avatar in the inbox so the operator instantly sees the channel.
"use client";

import { Mail } from "lucide-react";
import { cn } from "@/lib/utils";

export type LastChannel = "whatsapp" | "kleinanzeigen" | "email" | "sms";

/** Official WhatsApp glyph (rounded-square icon, green gradient + white phone). */
export function WhatsAppMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={className} aria-hidden>
      <defs>
        <linearGradient id="wa-grad" gradientUnits="userSpaceOnUse" x1="512" y1="1" x2="512" y2="1025">
          <stop offset="0" stopColor="#61fd7d" />
          <stop offset="1" stopColor="#2bb826" />
        </linearGradient>
      </defs>
      <path
        fill="url(#wa-grad)"
        d="M1023.941 765.153c0 5.606-.171 17.766-.508 27.159-.824 22.982-2.646 52.639-5.401 66.151-4.141 20.306-10.392 39.472-18.542 55.425-9.643 18.871-21.943 35.775-36.559 50.364-14.584 14.56-31.472 26.812-50.315 36.416-16.036 8.172-35.322 14.426-55.744 18.549-13.378 2.701-42.812 4.488-65.648 5.3-9.402.336-21.564.505-27.15.505l-504.226-.081c-5.607 0-17.765-.172-27.158-.509-22.983-.824-52.639-2.646-66.152-5.4-20.306-4.142-39.473-10.392-55.425-18.542-18.872-9.644-35.775-21.944-50.364-36.56-14.56-14.584-26.812-31.471-36.415-50.314-8.174-16.037-14.428-35.323-18.551-55.744-2.7-13.378-4.487-42.812-5.3-65.649-.334-9.401-.503-21.563-.503-27.148l.08-504.228c0-5.607.171-17.766.508-27.159.825-22.983 2.646-52.639 5.401-66.151 4.141-20.306 10.391-39.473 18.542-55.426C34.154 93.24 46.455 76.336 61.07 61.747c14.584-14.559 31.472-26.812 50.315-36.416 16.037-8.172 35.324-14.426 55.745-18.549 13.377-2.701 42.812-4.488 65.648-5.3 9.402-.335 21.565-.504 27.149-.504l504.227.081c5.608 0 17.766.171 27.159.508 22.983.825 52.638 2.646 66.152 5.401 20.305 4.141 39.472 10.391 55.425 18.542 18.871 9.643 35.774 21.944 50.363 36.559 14.559 14.584 26.812 31.471 36.415 50.315 8.174 16.037 14.428 35.323 18.551 55.744 2.7 13.378 4.486 42.812 5.3 65.649.335 9.402.504 21.564.504 27.15l-.082 504.226z"
      />
      <path
        fill="#FFF"
        d="M783.302 243.246c-69.329-69.387-161.529-107.619-259.763-107.658-202.402 0-367.133 164.668-367.214 367.072-.026 64.699 16.883 127.854 49.017 183.522l-52.096 190.229 194.665-51.047c53.636 29.244 114.022 44.656 175.482 44.682h.151c202.382 0 367.128-164.688 367.21-367.094.039-98.087-38.121-190.319-107.452-259.706zM523.544 808.047h-.125c-54.767-.021-108.483-14.729-155.344-42.529l-11.146-6.612-115.517 30.293 30.834-112.592-7.259-11.544c-30.552-48.579-46.688-104.729-46.664-162.379.066-168.229 136.985-305.096 305.339-305.096 81.521.031 158.154 31.811 215.779 89.482s89.342 134.332 89.312 215.859c-.066 168.243-136.984 305.118-305.209 305.118zm167.415-228.515c-9.177-4.591-54.286-26.782-62.697-29.843-8.41-3.062-14.526-4.592-20.645 4.592-6.115 9.182-23.699 29.843-29.053 35.964-5.352 6.122-10.704 6.888-19.879 2.296-9.176-4.591-38.74-14.277-73.786-45.526-27.275-24.319-45.691-54.359-51.043-63.543-5.352-9.183-.569-14.146 4.024-18.72 4.127-4.109 9.175-10.713 13.763-16.069 4.587-5.355 6.117-9.183 9.175-15.304 3.059-6.122 1.529-11.479-.765-16.07-2.293-4.591-20.644-49.739-28.29-68.104-7.447-17.886-15.013-15.466-20.645-15.747-5.346-.266-11.469-.322-17.585-.322s-16.057 2.295-24.467 11.478-32.113 31.374-32.113 76.521c0 45.147 32.877 88.764 37.465 94.885 4.588 6.122 64.699 98.771 156.741 138.502 21.892 9.45 38.982 15.094 52.308 19.322 21.98 6.979 41.982 5.995 57.793 3.634 17.628-2.633 54.284-22.189 61.932-43.615 7.646-21.427 7.646-39.791 5.352-43.617-2.294-3.826-8.41-6.122-17.585-10.714z"
      />
    </svg>
  );
}

/** Kleinanzeigen 2023 "k" glyph (brand dark green). */
export function KleinanzeigenMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 116 132" className={className} aria-hidden>
      <path
        fill="#1D4B00"
        d="M84.99 130.98C67.43 130.98 58.84 118.73 57.1 116.2C51.91 121.3 44.09 130.98 30 130.98C13.72 130.98 0 118.68 0 98.74V32.24C0 12.25 13.74 0 30 0C46.25 0 60 13.02 60 31.94C63.16 30.81 66.53 30.23 69.99 30.23C86.73 30.23 99.98 43.95 99.98 60.45C99.98 65.08 99.11 69.19 97.2 73.13C107.82 77.89 114.98 88.59 114.98 100.76C114.98 117.42 101.53 130.98 84.99 130.98ZM64.35 108.89C68.66 116.44 75.92 120.9 84.99 120.9C96.01 120.9 104.99 111.86 104.99 100.76C104.99 91.97 99.38 84.32 91.31 81.63L64.35 108.89ZM30 10.07C20.05 10.07 10 16.93 10 32.24V98.74C10 114.05 20.04 120.9 30 120.9C37.9 120.9 42.27 116.89 49.31 109.79L52.43 106.64C50.82 101.81 49.99 96.45 49.99 90.67V32.24C49.99 16.92 39.95 10.07 30 10.07ZM59.99 42.99V90.68C59.99 93.38 60.22 95.95 60.65 98.37L82.38 76.47C88.69 70.11 89.99 65.47 89.99 60.45C89.99 49.75 81.45 40.3 69.99 40.3C66.43 40.3 63.01 41.23 59.99 42.99Z"
      />
    </svg>
  );
}

/** Compact channel mark sized for inline badges. */
export function ChannelMark({
  channel,
  className,
}: {
  channel: LastChannel;
  className?: string;
}) {
  if (channel === "whatsapp") return <WhatsAppMark className={className} />;
  if (channel === "kleinanzeigen") return <KleinanzeigenMark className={className} />;
  return <Mail className={cn("text-[#3b6fb8]", className)} aria-hidden />;
}

const TILE: Record<LastChannel, string> = {
  whatsapp: "bg-[#e7faef]",
  kleinanzeigen: "bg-[#eaf4d8]",
  email: "bg-[#e8f0fb]",
  sms: "bg-[#e8f0fb]",
};

const LABEL: Record<LastChannel, string> = {
  whatsapp: "WhatsApp",
  kleinanzeigen: "Kleinanzeigen",
  email: "E-Mail",
  sms: "SMS",
};

/**
 * Person avatar that renders the last-used channel as a rounded tile. The
 * channel is the single strongest "where do I answer" signal in the inbox,
 * so it earns the avatar slot.
 */
export function ChannelAvatar({
  channel,
  size = "md",
  className,
}: {
  channel: LastChannel;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const tileDim =
    size === "lg" ? "h-11 w-11" : size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const glyphDim =
    channel === "whatsapp"
      ? size === "lg"
        ? "h-11 w-11"
        : size === "sm"
          ? "h-7 w-7"
          : "h-9 w-9" // WhatsApp glyph is a full icon → fill the tile
      : size === "lg"
        ? "h-6 w-6"
        : size === "sm"
          ? "h-4 w-4"
          : "h-5 w-5";

  // WhatsApp ships as a complete rounded-square icon → render it borderless.
  if (channel === "whatsapp") {
    return (
      <span
        className={cn("inline-flex shrink-0 overflow-hidden rounded-[10px]", tileDim, className)}
        title={LABEL[channel]}
        aria-label={LABEL[channel]}
      >
        <WhatsAppMark className={glyphDim} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[10px]",
        tileDim,
        TILE[channel],
        className
      )}
      title={LABEL[channel]}
      aria-label={LABEL[channel]}
    >
      <ChannelMark channel={channel} className={glyphDim} />
    </span>
  );
}
