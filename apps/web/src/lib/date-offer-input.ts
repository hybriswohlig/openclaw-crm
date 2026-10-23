/**
 * Shared checks for alternative move-date offers.
 * The composer replaces the whole set; MCP creates, updates and deletes one row.
 */

export const MAX_DATE_OFFERS = 10;
export const MAX_DATE_SLOTS = 6;

export interface ParsedDateSlot {
  label: string;
  startTime: string | null;
  endTime: string | null;
}

export interface ParsedDateOffer {
  date: string;
  slots: ParsedDateSlot[];
  note: string | null;
  isRecommended: boolean;
}

export type DateOfferParseResult =
  | { ok: true; offer: ParsedDateOffer }
  | { ok: false; error: string };

function parseSlots(raw: unknown, date: string): { ok: true; slots: ParsedDateSlot[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: `Each offer must have at least one slot (${date || "offer"})` };
  }
  if (raw.length > MAX_DATE_SLOTS) {
    return { ok: false, error: `At most ${MAX_DATE_SLOTS} slots per offer (${date || "offer"})` };
  }
  const slots = raw.map((item) => {
    const slot = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      label: typeof slot.label === "string" ? slot.label.trim() : "",
      startTime: typeof slot.startTime === "string" && slot.startTime.trim() ? slot.startTime.trim() : null,
      endTime: typeof slot.endTime === "string" && slot.endTime.trim() ? slot.endTime.trim() : null,
    };
  });
  if (slots.some((slot) => !slot.label)) {
    return { ok: false, error: "Each slot needs a non-empty label" };
  }
  return { ok: true, slots };
}

export function parseDateOffer(raw: unknown): DateOfferParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Offer must be an object" };
  }
  const body = raw as Record<string, unknown>;
  const date = typeof body.date === "string" ? body.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: `Invalid date: ${date}` };
  }
  const slots = parseSlots(body.slots, date);
  if (!slots.ok) return slots;
  return {
    ok: true,
    offer: {
      date,
      slots: slots.slots,
      note: typeof body.note === "string" ? body.note : null,
      isRecommended: !!body.isRecommended,
    },
  };
}

export type DateOfferPatch = {
  date?: string;
  slots?: ParsedDateSlot[];
  note?: string | null;
  isRecommended?: boolean;
};

export function parseDateOfferPatch(raw: unknown): { ok: true; patch: DateOfferPatch } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Offer must be an object" };
  }
  const body = raw as Record<string, unknown>;
  const patch: DateOfferPatch = {};
  if (body.date !== undefined) {
    if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return { ok: false, error: `Invalid date: ${String(body.date ?? "")}` };
    }
    patch.date = body.date;
  }
  if (body.slots !== undefined) {
    const slots = parseSlots(body.slots, patch.date ?? "");
    if (!slots.ok) return slots;
    patch.slots = slots.slots;
  }
  if (body.note !== undefined) {
    if (body.note !== null && typeof body.note !== "string") {
      return { ok: false, error: "note must be a string or null" };
    }
    patch.note = body.note;
  }
  if (body.isRecommended !== undefined) {
    if (typeof body.isRecommended !== "boolean") {
      return { ok: false, error: "isRecommended must be a boolean" };
    }
    patch.isRecommended = body.isRecommended;
  }
  if (
    patch.date === undefined &&
    patch.slots === undefined &&
    patch.note === undefined &&
    patch.isRecommended === undefined
  ) {
    return { ok: false, error: "Nothing to update" };
  }
  return { ok: true, patch };
}
