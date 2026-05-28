/**
 * Twitter Card variant — same renderer as opengraph-image.tsx so the
 * preview is identical across X / WhatsApp / iMessage / Telegram /
 * LinkedIn. We re-export the OG component so a single design owns both.
 */
export { default, alt, size, contentType, runtime } from "./opengraph-image";
