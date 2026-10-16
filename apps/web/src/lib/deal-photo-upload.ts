// JSON photo upload for agents that can only POST JSON (crm_api / MCP).
//
// crm_upload_deal_photo cannot build multipart, and POST .../portal-photos
// accepts only multipart. Base64 expands by 4/3, so a decoded photo at
// MAX_DEAL_PHOTO_BYTES (3 MB → ~4 MB of base64, plus a small envelope) stays
// under Vercel's ~4.5 MB request-body limit. A batch is capped at the same
// decoded total, because the whole JSON body has to fit in one request.

import { createHash } from "node:crypto";
import {
  MAX_JSON_INLINE_BYTES,
  normaliseBase64,
} from "@/lib/attachment-content";

/** Same ceiling as JSON deal documents: 3 MB decoded. */
export const MAX_DEAL_PHOTO_BYTES = MAX_JSON_INLINE_BYTES;

/** Operator multipart portal uploads use this prefix and are customer-visible. */
export const PORTAL_UPLOAD_PREFIX = "portal-upload:";

/**
 * Agent JSON uploads. Stored in the same attachment table, but not a portal
 * upload: the customer status portal must not list or serve them.
 */
export const INTERNAL_PHOTO_PREFIX = "internal-photo:";

export const MAX_DEAL_PHOTOS_PER_REQUEST = 20;

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
const HEIF_BRANDS = new Set(["heif", "mif1", "msf1"]);

const DATA_URL_PREFIX = /^data:[^,]*,/i;

export function jsonDealPhotoTooLargeMessage(): string {
  return (
    `Photo too large for JSON upload (max ${MAX_DEAL_PHOTO_BYTES} bytes decoded, 3 MB). ` +
    "Base64 of a larger photo exceeds Vercel's ~4.5 MB request limit and is not stored."
  );
}

export function jsonDealPhotoBatchTooLargeMessage(): string {
  return (
    `Photos too large for one JSON upload (max ${MAX_DEAL_PHOTO_BYTES} bytes decoded in total, 3 MB). ` +
    "Base64 of a larger body exceeds Vercel's ~4.5 MB request limit and nothing is stored."
  );
}

/** Size gate for one photo. Null when the decoded size fits. */
export function oversizedJsonDealPhotoError(decodedBytes: number): string | null {
  if (!Number.isFinite(decodedBytes) || decodedBytes > MAX_DEAL_PHOTO_BYTES) {
    return jsonDealPhotoTooLargeMessage();
  }
  return null;
}

export function isInternalPhotoCarrier(
  externalMessageId: string | null | undefined
): boolean {
  return (externalMessageId ?? "").startsWith(INTERNAL_PHOTO_PREFIX);
}

/**
 * Photos the customer may see on the status portal.
 * Inbound images and operator portal-uploads. Internal agent uploads are not.
 */
export function isCustomerVisibleDealPhoto(input: {
  direction: string;
  externalMessageId: string | null | undefined;
}): boolean {
  if (isInternalPhotoCarrier(input.externalMessageId)) return false;
  if (input.direction === "inbound") return true;
  return (input.externalMessageId ?? "").startsWith(PORTAL_UPLOAD_PREFIX);
}

/** Photos listed on the deal (portal grid + internal agent uploads). */
export function isDealSurfacePhoto(input: {
  direction: string;
  externalMessageId: string | null | undefined;
}): boolean {
  return (
    isCustomerVisibleDealPhoto(input) || isInternalPhotoCarrier(input.externalMessageId)
  );
}

export function dealPhotoSource(input: {
  direction: string;
  externalMessageId: string | null | undefined;
}): "customer" | "operator" | "internal" {
  if (isInternalPhotoCarrier(input.externalMessageId)) return "internal";
  if (
    input.direction === "outbound" ||
    (input.externalMessageId ?? "").startsWith(PORTAL_UPLOAD_PREFIX)
  ) {
    return "operator";
  }
  return "customer";
}

export function contentSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Image type implied by the file header, or null when it is not a known image. */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 6) {
    const sig = ascii(bytes, 0, 6);
    if (sig === "GIF87a" || sig === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12).toLowerCase();
    if (HEIC_BRANDS.has(brand)) return "image/heic";
    if (HEIF_BRANDS.has(brand)) return "image/heif";
  }
  return null;
}

export interface PreparedDealPhoto {
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileContent: string;
  contentSha256: string;
}

export type DealPhotoUploadFailure = {
  ok: false;
  status: 400 | 413;
  code: string;
  error: string;
};

export function prepareDealPhotoUploads(
  body: unknown
): { ok: true; photos: PreparedDealPhoto[] } | DealPhotoUploadFailure {
  const listed = readPhotoList(body);
  if (!listed.ok) return listed;

  const sized: Array<{ raw: RawPhoto; decodedBytes: number; normalised: string }> = [];
  let total = 0;
  for (let i = 0; i < listed.raw.length; i++) {
    const raw = listed.raw[i]!;
    const label = listed.raw.length === 1 ? "photo" : `photos[${i}]`;
    const fields = readPhotoFields(raw, label);
    if (!fields.ok) return fields;
    total += fields.decodedBytes;
    if (total > MAX_DEAL_PHOTO_BYTES) {
      return {
        ok: false,
        status: 413,
        code: "FILE_TOO_LARGE",
        error: jsonDealPhotoBatchTooLargeMessage(),
      };
    }
    sized.push({
      raw,
      decodedBytes: fields.decodedBytes,
      normalised: fields.normalised,
    });
  }

  const photos: PreparedDealPhoto[] = [];
  for (let i = 0; i < sized.length; i++) {
    const item = sized[i]!;
    const label = sized.length === 1 ? "photo" : `photos[${i}]`;
    const prepared = decodeAndCheck(item.raw, item.normalised, label);
    if (!prepared.ok) return prepared;
    photos.push(prepared.photo);
  }
  return { ok: true, photos };
}

interface RawPhoto {
  filename: unknown;
  contentType: unknown;
  dataBase64: unknown;
}

function readPhotoList(
  body: unknown
): { ok: true; raw: RawPhoto[] } | DealPhotoUploadFailure {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_INPUT",
      error: "JSON body must be an object with filename, contentType and dataBase64, or photos",
    };
  }
  const record = body as Record<string, unknown>;
  if (record.photos !== undefined) {
    if (!Array.isArray(record.photos)) {
      return { ok: false, status: 400, code: "INVALID_INPUT", error: "photos must be an array" };
    }
    if (record.photos.length === 0) {
      return { ok: false, status: 400, code: "NO_FILES", error: "photos is empty" };
    }
    if (record.photos.length > MAX_DEAL_PHOTOS_PER_REQUEST) {
      return {
        ok: false,
        status: 400,
        code: "TOO_MANY_FILES",
        error: `At most ${MAX_DEAL_PHOTOS_PER_REQUEST} photos per request`,
      };
    }
    return { ok: true, raw: record.photos.map(asRaw) };
  }
  return { ok: true, raw: [asRaw(record)] };
}

function asRaw(value: unknown): RawPhoto {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { filename: undefined, contentType: undefined, dataBase64: undefined };
  }
  const record = value as Record<string, unknown>;
  return {
    filename: record.filename,
    contentType: record.contentType,
    dataBase64: record.dataBase64,
  };
}

function readPhotoFields(
  raw: RawPhoto,
  label: string
):
  | { ok: true; decodedBytes: number; normalised: string }
  | DealPhotoUploadFailure {
  if (typeof raw.filename !== "string" || !raw.filename.trim()) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_INPUT",
      error: `${label} requires filename, contentType and dataBase64`,
    };
  }
  if (typeof raw.contentType !== "string" || !raw.contentType.trim()) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_INPUT",
      error: `${label} requires filename, contentType and dataBase64`,
    };
  }
  if (!ALLOWED_MIME.has(canonicalMime(raw.contentType))) {
    return {
      ok: false,
      status: 400,
      code: "UNSUPPORTED_TYPE",
      error: `${label} contentType must be an image (jpeg, png, webp, gif, heic, heif)`,
    };
  }
  if (typeof raw.dataBase64 !== "string" || !raw.dataBase64.trim()) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_INPUT",
      error: `${label} requires filename, contentType and dataBase64`,
    };
  }
  const padded = paddedBase64(normalisedDealPhotoBase64(raw.dataBase64));
  if (!padded) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_INPUT",
      error: `${label} dataBase64 is not valid base64`,
    };
  }
  const decodedBytes = base64DecodedLength(padded);
  if (decodedBytes <= 0) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_INPUT",
      error: `${label} is empty`,
    };
  }
  // Reject before Buffer.from so an oversized body is not allocated.
  const tooBig = oversizedJsonDealPhotoError(decodedBytes);
  if (tooBig) return { ok: false, status: 413, code: "FILE_TOO_LARGE", error: tooBig };
  const fileContent = canonicalBase64(padded);
  if (!fileContent) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_INPUT",
      error: `${label} dataBase64 is not valid base64`,
    };
  }
  return { ok: true, decodedBytes, normalised: fileContent };
}

function decodeAndCheck(
  raw: RawPhoto,
  fileContent: string,
  label: string
): { ok: true; photo: PreparedDealPhoto } | DealPhotoUploadFailure {
  const bytes = Buffer.from(fileContent, "base64");
  const tooBig = oversizedJsonDealPhotoError(bytes.length);
  if (tooBig) return { ok: false, status: 413, code: "FILE_TOO_LARGE", error: tooBig };

  const declared = canonicalMime(raw.contentType as string);
  const sniffed = sniffImageMime(bytes);
  if (!sniffed || !mimesCompatible(declared, sniffed)) {
    return {
      ok: false,
      status: 400,
      code: "NOT_AN_IMAGE",
      error: `${label} is not a ${declared} image`,
    };
  }

  return {
    ok: true,
    photo: {
      fileName: sanitiseFileName(raw.filename as string, sniffed),
      mimeType: sniffed,
      fileSize: bytes.length,
      fileContent,
      contentSha256: contentSha256Hex(bytes),
    },
  };
}

export function normalisedDealPhotoBase64(dataBase64: string): string {
  return normaliseBase64(dataBase64.trim().replace(DATA_URL_PREFIX, ""));
}

function canonicalMime(mime: string): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  return base === "image/jpg" ? "image/jpeg" : base;
}

function mimesCompatible(declared: string, sniffed: string): boolean {
  if (declared === sniffed) return true;
  const heif = new Set(["image/heic", "image/heif"]);
  return heif.has(declared) && heif.has(sniffed);
}

function sanitiseFileName(name: string, mime: string): string {
  const cleaned = name.replace(/[\\/"\r\n]/g, "_").trim().slice(0, 180);
  if (cleaned) return cleaned;
  const ext =
    mime === "image/png"
      ? "png"
      : mime === "image/webp"
        ? "webp"
        : mime === "image/gif"
          ? "gif"
          : mime === "image/heic" || mime === "image/heif"
            ? "heic"
            : "jpg";
  return `foto.${ext}`;
}

/** Pad and check the alphabet. Does not allocate the decoded bytes. */
function paddedBase64(normalised: string): string | null {
  if (!normalised) return null;
  const mod = normalised.length % 4;
  if (mod === 1) return null;
  const padded = mod === 0 ? normalised : normalised + "=".repeat(4 - mod);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) return null;
  return padded;
}

function canonicalBase64(padded: string): string | null {
  const bytes = Buffer.from(padded, "base64");
  if (bytes.toString("base64") !== padded) return null;
  return padded;
}

function base64DecodedLength(padded: string): number {
  let padding = 0;
  if (padded.endsWith("==")) padding = 2;
  else if (padded.endsWith("=")) padding = 1;
  return Math.floor((padded.length * 3) / 4) - padding;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}
