/**
 * Shared, framework-agnostic helpers for the Sales-Outreach-Agent
 * "Antwort-Entwurf" draft notes. Used by:
 *
 * - the per-conversation draft suggestion banner (client component) at
 *   `components/chat/draft-suggestion-banner.tsx`
 * - the cross-record drafts approval queue (server route + page) under
 *   `app/api/v1/inbox/drafts` and `app/(dashboard)/inbox/drafts`
 *
 * Pure functions only — do not import React, Next.js, or db.
 */

// Title prefix produced by the Sales Outreach Agent in Paperclip when it
// drops a reply suggestion onto a record. Detection only matches notes that
// start with this prefix and have not yet been marked as consumed.
export const DRAFT_TITLE_PREFIX = "Antwort-Entwurf · Sales Outreach Agent";
export const CONSUMED_TITLE_MARKER = "Übernommen";

export interface RawDraftNote {
  id: string;
  recordId: string;
  title: string;
  content: unknown;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** True if the note is a Sales-Outreach-Agent draft that has not yet been approved/sent. */
export function isAgentDraft(note: { title?: string | null }): boolean {
  const t = note.title ?? "";
  if (!t.startsWith(DRAFT_TITLE_PREFIX)) return false;
  if (t.includes(CONSUMED_TITLE_MARKER)) return false;
  return true;
}

/** Format the new note title used after a draft has been approved & sent. */
export function consumedTitle(date: Date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `Antwort-Entwurf · ${CONSUMED_TITLE_MARKER} am ${dd}.${mm}.${yyyy}`;
}

/**
 * Render TipTap JSON to plain text. Emits `\n` for `hardBreak` nodes so notes
 * that pack the whole draft into a single paragraph still keep usable line
 * structure. Mirrors the server-side helper in `services/deal-insights.ts`.
 */
export function tiptapToPlainText(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return "";
  const n = node as Record<string, unknown>;
  if (n.type === "hardBreak") return "\n";
  if (typeof n.text === "string") return n.text;
  const content = n.content;
  if (Array.isArray(content)) {
    const isBlock = ["paragraph", "heading", "listItem", "blockquote"].includes(
      typeof n.type === "string" ? n.type : ""
    );
    return content.map(tiptapToPlainText).join("") + (isBlock ? "\n" : "");
  }
  return "";
}

function paragraphIsAllItalic(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as { content?: unknown };
  if (!Array.isArray(n.content) || n.content.length === 0) return false;
  let sawText = false;
  for (const child of n.content) {
    const c = child as { type?: string; text?: string; marks?: unknown };
    if (c.type !== "text") return false;
    if (typeof c.text !== "string" || c.text.length === 0) continue;
    sawText = true;
    const marks = Array.isArray(c.marks) ? c.marks : [];
    const italic = marks.some(
      (m) => (m as { type?: string }).type === "italic"
    );
    if (!italic) return false;
  }
  return sawText;
}

const SEPARATOR_GLYPHS = /[─━═│┃║╔╗╚╝╠╣╦╩╬\-_=*•~⎯]/g;

function paragraphIsSeparator(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  const glyphs = t.match(SEPARATOR_GLYPHS) || [];
  if (glyphs.length < 6) return false;
  const rest = t.replace(SEPARATOR_GLYPHS, "").replace(/\s+/g, " ").trim();
  return rest.length <= 50;
}

const PREAMBLE_LINE_PATTERNS: RegExp[] = [
  /^antwort[-\s]?entwurf\s*[·•|–-]\s*sales\s+outreach\s+agent/i,
  /^kanal\s*:/i,
  /^ton(alit[äa]t)?\s*:/i,
  /^phase\s*:/i,
  /^betreff\s*:/i,
  /^subject\s*:/i,
];

function isPreambleLine(line: string): boolean {
  return PREAMBLE_LINE_PATTERNS.some((re) => re.test(line));
}

const ANALYSIS_LABEL_PATTERNS: RegExp[] = [
  /^verkaufspsychologische\s+hebel\b/i,
  /^(was\s+)?bewusst\s+weggelassen\b/i,
  /^wahrscheinliche\s+antwort\b/i,
  /^conversion[-\s]?einsch[äa]tzung\b/i,
  /^kontext\s+zu(m|r)?\b/i,
  /^referenz\s*:/i,
  /^quelle\s*:/i,
];

function isAnalysisSectionLabel(line: string): boolean {
  return ANALYSIS_LABEL_PATTERNS.some((re) => re.test(line));
}

const GREETING_PATTERNS: RegExp[] = [
  /^hallo\b/i,
  /^hi\b/i,
  /^hey\b/i,
  /^moin\b/i,
  /^guten\s+(tag|morgen|abend)\b/i,
  /^sehr\s+geehrt(er?|e\s+(frau|herr|damen))/i,
  /^liebe[rsn]?\b/i,
];

function looksLikeGreeting(line: string): boolean {
  return GREETING_PATTERNS.some((re) => re.test(line));
}

function extractFromPlainText(text: string): string | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/);

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (looksLikeGreeting(lines[i].trim())) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  const isSepLine = (line: string) => paragraphIsSeparator(line);
  const isLabelLine = (line: string) => isAnalysisSectionLabel(line.trim());

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (isSepLine(lines[i]) || isLabelLine(lines[i])) {
      endIdx = i;
      break;
    }
  }

  while (endIdx > startIdx + 1 && lines[endIdx - 1].trim().length === 0) {
    endIdx--;
  }

  const body = lines.slice(startIdx, endIdx).join("\n").trim();
  if (body.length < 40) return null;
  return body;
}

/**
 * Pull the email body out of a Sales-Outreach-Agent draft note. Handles the
 * two observed scaffolding shapes (R.H.-style TipTap with horizontalRules and
 * headings; Josefine-style plain-text scaffolding with box-drawing separators
 * and section labels) via a single state machine, with a string-level
 * fallback for unrecognized variants. See draft-suggestion-banner.tsx for the
 * full shape examples.
 */
export function extractDraftMessage(content: unknown): string {
  const fullText = tiptapToPlainText(content).trim();
  if (!content || typeof content !== "object") {
    return extractFromPlainText(fullText) ?? fullText;
  }
  const root = content as { content?: unknown };
  const top = Array.isArray(root.content) ? root.content : null;
  if (!top) return extractFromPlainText(fullText) ?? fullText;

  const kept: unknown[] = [];
  type State = "preamble" | "body" | "analysis";
  let state: State = "preamble";

  for (const child of top) {
    if (state === "analysis") continue;
    const c = child as { type?: string };

    if (c.type === "heading") {
      if (state === "body") state = "analysis";
      continue;
    }
    if (c.type === "horizontalRule") {
      state = state === "preamble" ? "body" : "analysis";
      continue;
    }

    if (c.type === "paragraph") {
      const line = tiptapToPlainText(child).trim();

      if (paragraphIsSeparator(line)) {
        state = state === "preamble" ? "body" : "analysis";
        continue;
      }

      if (line.length > 0 && isAnalysisSectionLabel(line)) {
        state = "analysis";
        continue;
      }

      if (paragraphIsAllItalic(child)) {
        if (state === "body") state = "analysis";
        continue;
      }

      if (state === "preamble") {
        if (line.length === 0) continue;
        if (isPreambleLine(line)) continue;
        if (looksLikeGreeting(line)) {
          state = "body";
          kept.push(child);
          continue;
        }
        continue;
      }

      if (line.length === 0) {
        if (kept.length > 0) kept.push(child);
        continue;
      }
      if (isPreambleLine(line)) continue;
      kept.push(child);
      continue;
    }

    if (state === "body") {
      kept.push(child);
    }
  }

  while (kept.length > 0) {
    const last = kept[kept.length - 1];
    if (tiptapToPlainText(last).trim().length === 0) {
      kept.pop();
    } else break;
  }

  const trimmed = tiptapToPlainText({ type: "doc", content: kept }).trim();
  if (trimmed.length >= 40) return trimmed;

  const stringLevel = extractFromPlainText(fullText);
  if (stringLevel) return stringLevel;

  return trimmed || fullText;
}
