/**
 * Per-firma dynamic OG card for the customer status link.
 *
 * Next.js renders this on-demand at build / first request and caches it,
 * so a token-specific URL like /s/abc.../opengraph-image is fetched
 * exactly once by WhatsApp / iMessage / etc. The card paints:
 *
 *   - firma display name (Kottke Dienstleistungen / Ceylan Umzüge & …)
 *   - deal number ("Auftrag KOT-2026-042")
 *   - large brand-color rule across the top so the preview reads as the
 *     firma's, not a third product
 *
 * If the token is unknown / revoked we return a neutral, brand-less
 * card so existence is not leaked through the OG endpoint either.
 */
import { ImageResponse } from "next/og";
import { loadContextByToken } from "@/services/customer-portal-data";

export const runtime = "nodejs";
export const alt = "Auftragsstatus";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const ctx = await loadContextByToken(token).catch(() => null);

  const firma = ctx?.branding.displayName ?? "Auftrag";
  const dealNumber = ctx?.dealNumber ?? "";
  const hex = sanitizeHex(ctx?.branding.primaryColor) ?? "1e3a5f";
  const accent = `#${hex}`;
  const accentTint = `${accent}1f`;
  const customerName = ctx?.customerDisplayName ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          fontFamily: "Inter, system-ui, sans-serif",
          position: "relative",
        }}
      >
        {/* Brand-tinted radial wash so the card feels owned by the firma. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(60% 80% at 10% 0%, ${accentTint}, transparent 70%)`,
          }}
        />

        {/* Top accent rule — single solid bar in the firma's primary color. */}
        <div
          style={{
            height: 14,
            width: "100%",
            background: accent,
          }}
        />

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "80px 96px",
            position: "relative",
          }}
        >
          {/* Top chip with firma name and brand dot. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 28,
              fontWeight: 600,
              color: accent,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                background: accent,
              }}
            />
            {firma}
          </div>

          {/* Main headline. Deal number is the calmest, biggest line. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div
              style={{
                fontSize: 36,
                fontWeight: 500,
                color: "#56627a",
              }}
            >
              {dealNumber ? "Ihr Auftrag" : "Auftragsportal"}
            </div>
            {dealNumber && (
              <div
                style={{
                  fontSize: 108,
                  fontWeight: 600,
                  color: "#0f1722",
                  lineHeight: 1,
                  letterSpacing: "-0.02em",
                }}
              >
                {dealNumber}
              </div>
            )}
            {customerName && (
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 500,
                  color: "#56627a",
                }}
              >
                für {customerName}
              </div>
            )}
          </div>

          {/* Footer row — sub-line, no third brand name. */}
          <div
            style={{
              fontSize: 24,
              color: "#8a95ab",
            }}
          >
            Angebot · Status · Bestätigung
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}

function sanitizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const stripped = input.replace(/^#/, "").trim();
  return /^[0-9a-fA-F]{6}$/.test(stripped) ? stripped : null;
}
