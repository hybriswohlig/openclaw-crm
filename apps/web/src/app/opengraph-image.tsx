/**
 * Fallback OG card — only shown for non-portal routes (dashboard root etc.).
 *
 * For customer status links, `(public)/s/[token]/opengraph-image.tsx`
 * overrides this with a per-firma card, so the OpenCRM/Umzug-Suite brand
 * is never visible to customers.
 */
import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Umzug-Suite";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #0c0c12 0%, #0e1018 50%, #0c0c14 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 500,
            height: 500,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(99, 102, 241, 0.25) 0%, transparent 70%)",
            top: "10%",
            left: "35%",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            marginBottom: 24,
          }}
        >
          <span style={{ fontSize: 64, fontWeight: 700, color: "#f0f0f5" }}>
            Umzug-
          </span>
          <span
            style={{
              fontSize: 64,
              fontWeight: 700,
              background: "linear-gradient(135deg, #818cf8, #6366f1, #4f46e5)",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Suite
          </span>
        </div>

        <p style={{ fontSize: 28, color: "#9ca3af", margin: 0 }}>
          Operative Steuerung für Umzüge und Transporte.
        </p>
      </div>
    ),
    { ...size }
  );
}
