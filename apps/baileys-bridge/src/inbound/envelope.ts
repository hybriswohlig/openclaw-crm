/**
 * Helpers for unwrapping Baileys' nested message envelopes.
 *
 * WhatsApp wraps user content in a tree of optional message types:
 * `viewOnceMessage`, `ephemeralMessage`, `documentWithCaptionMessage`, etc.
 * The actual payload (text or media) lives inside. This module flattens
 * one level of nesting and exposes the relevant fields the inbound handler
 * needs without leaking proto types upstream.
 */
import type { proto } from "baileys";

export type MediaKind = "image" | "video" | "audio" | "document" | "sticker";

/** Strip view-once / ephemeral wrappers and return the inner message. */
export function unwrap(m: proto.IMessage): proto.IMessage {
  const v = m as Record<string, unknown>;
  if (v.ephemeralMessage) {
    return unwrap(
      ((v.ephemeralMessage as { message?: proto.IMessage }).message ??
        m) as proto.IMessage,
    );
  }
  if (v.viewOnceMessage) {
    return unwrap(
      ((v.viewOnceMessage as { message?: proto.IMessage }).message ??
        m) as proto.IMessage,
    );
  }
  if (v.viewOnceMessageV2) {
    return unwrap(
      ((v.viewOnceMessageV2 as { message?: proto.IMessage }).message ??
        m) as proto.IMessage,
    );
  }
  if (v.viewOnceMessageV2Extension) {
    return unwrap(
      ((v.viewOnceMessageV2Extension as { message?: proto.IMessage })
        .message ?? m) as proto.IMessage,
    );
  }
  if (v.documentWithCaptionMessage) {
    return unwrap(
      ((v.documentWithCaptionMessage as { message?: proto.IMessage })
        .message ?? m) as proto.IMessage,
    );
  }
  return m;
}

export function textOf(m: proto.IMessage): string {
  const inner = unwrap(m);
  const v = inner as Record<string, unknown>;
  if (typeof v.conversation === "string") return v.conversation;
  if (v.extendedTextMessage) {
    const t = (v.extendedTextMessage as { text?: string }).text;
    if (typeof t === "string") return t;
  }
  if (v.imageMessage) {
    const c = (v.imageMessage as { caption?: string }).caption;
    if (typeof c === "string") return c;
  }
  if (v.videoMessage) {
    const c = (v.videoMessage as { caption?: string }).caption;
    if (typeof c === "string") return c;
  }
  if (v.documentMessage) {
    const c = (v.documentMessage as { caption?: string }).caption;
    if (typeof c === "string") return c;
  }
  if (v.buttonsResponseMessage) {
    const t = (v.buttonsResponseMessage as { selectedDisplayText?: string })
      .selectedDisplayText;
    if (typeof t === "string") return t;
  }
  if (v.listResponseMessage) {
    const t = (v.listResponseMessage as { title?: string }).title;
    if (typeof t === "string") return t;
  }
  return "";
}

export function captionOf(m: proto.IMessage): string {
  return textOf(m);
}

export function mediaKindOf(m: proto.IMessage): MediaKind | null {
  const inner = unwrap(m);
  const v = inner as Record<string, unknown>;
  if (v.imageMessage) return "image";
  if (v.videoMessage) return "video";
  if (v.audioMessage) return "audio";
  if (v.documentMessage) return "document";
  if (v.stickerMessage) return "sticker";
  return null;
}

export function mimeOf(m: proto.IMessage, kind: MediaKind): string {
  const inner = unwrap(m);
  const env = (inner as Record<string, unknown>)[`${kind}Message`] as
    | { mimetype?: string }
    | undefined;
  return env?.mimetype || guessMime(kind);
}

export function filenameOf(
  m: proto.IMessage,
  kind: MediaKind,
  mime: string,
): string {
  const inner = unwrap(m);
  const env = (inner as Record<string, unknown>)[`${kind}Message`] as
    | { fileName?: string; title?: string }
    | undefined;
  if (env?.fileName) return env.fileName;
  if (env?.title) return env.title;
  const ext = mime.split("/")[1]?.split(";")[0] || "bin";
  return `${kind}.${ext}`;
}

export function previewLabelFor(kind: MediaKind | null): string | null {
  switch (kind) {
    case "image":
      return "📷 Bild";
    case "video":
      return "🎞️ Video";
    case "audio":
      return "🎤 Sprachnachricht";
    case "document":
      return "📎 Dokument";
    case "sticker":
      return "🏷️ Sticker";
    default:
      return null;
  }
}

function guessMime(kind: MediaKind): string {
  switch (kind) {
    case "image":
      return "image/jpeg";
    case "video":
      return "video/mp4";
    case "audio":
      return "audio/ogg";
    case "document":
      return "application/octet-stream";
    case "sticker":
      return "image/webp";
  }
}

/** Strip JID suffixes, return digits only. */
export function jidToWaId(jid: string | null | undefined): string {
  if (!jid) return "";
  return jid
    .replace(/@.*$/, "")
    .replace(/^\+/, "")
    .replace(/\s+/g, "")
    .replace(/:.*$/, "");
}

// Strips the device suffix (`:N`) but keeps the domain (`@lid` or
// `@s.whatsapp.net`). Required so the CRM can remember which addressing
// mode a contact answered from — without it, contacts whose Meta identity
// has migrated to LID-routing become unreachable on outbound, because the
// bridge would wrongly default the reply to `@s.whatsapp.net`.
export function jidToPeerJid(jid: string | null | undefined): string {
  if (!jid) return "";
  const at = jid.indexOf("@");
  if (at < 0) return jid.replace(/^\+/, "").replace(/\s+/g, "");
  const local = jid
    .slice(0, at)
    .replace(/^\+/, "")
    .replace(/\s+/g, "")
    .replace(/:.*$/, "");
  return `${local}${jid.slice(at)}`;
}
