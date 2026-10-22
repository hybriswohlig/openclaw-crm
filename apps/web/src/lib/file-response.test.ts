import { describe, expect, it } from "vitest";
import { fileResponseHeaders } from "./file-response";

// Stored files carry the MIME type their sender declared (inbound email,
// WhatsApp, member uploads). Served inline from the CRM origin, an SVG or
// HTML file runs script with the viewer's session. Only types that cannot
// script stay inline; everything else is forced to download.
describe("fileResponseHeaders", () => {
  it("forces svg to download as octet-stream", () => {
    const h = fileResponseHeaders({ mimeType: "image/svg+xml", fileName: "x.svg" });
    expect(h["Content-Type"]).toBe("application/octet-stream");
    expect(h["Content-Disposition"]).toMatch(/^attachment;/);
  });

  it("forces html with charset to download", () => {
    const h = fileResponseHeaders({ mimeType: "text/html; charset=utf-8", fileName: "x.html" });
    expect(h["Content-Type"]).toBe("application/octet-stream");
    expect(h["Content-Disposition"]).toMatch(/^attachment;/);
  });

  it("treats a missing mime type as download", () => {
    const h = fileResponseHeaders({ mimeType: null, fileName: "x" });
    expect(h["Content-Type"]).toBe("application/octet-stream");
    expect(h["Content-Disposition"]).toMatch(/^attachment;/);
  });

  it("keeps raster images inline", () => {
    const h = fileResponseHeaders({ mimeType: "IMAGE/PNG", fileName: "foto.png" });
    expect(h["Content-Type"]).toBe("image/png");
    expect(h["Content-Disposition"]).toMatch(/^inline;/);
  });

  it("keeps pdf inline unless download requested", () => {
    expect(
      fileResponseHeaders({ mimeType: "application/pdf", fileName: "kv.pdf" })["Content-Disposition"]
    ).toMatch(/^inline;/);
    const dl = fileResponseHeaders({ mimeType: "application/pdf", fileName: "kv.pdf", download: true });
    expect(dl["Content-Disposition"]).toMatch(/^attachment;/);
    expect(dl["Content-Type"]).toBe("application/pdf");
  });

  it("keeps audio and video inline", () => {
    const audio = fileResponseHeaders({ mimeType: "audio/ogg; codecs=opus", fileName: "voice.ogg" });
    expect(audio["Content-Type"]).toBe("audio/ogg");
    expect(audio["Content-Disposition"]).toMatch(/^inline;/);
    expect(
      fileResponseHeaders({ mimeType: "video/mp4", fileName: "clip.mp4" })["Content-Disposition"]
    ).toMatch(/^inline;/);
  });

  it("always sets nosniff", () => {
    for (const mimeType of ["image/jpeg", "image/svg+xml", null]) {
      expect(fileResponseHeaders({ mimeType, fileName: "f" })["X-Content-Type-Options"]).toBe(
        "nosniff"
      );
    }
  });

  it("produces ByteString-safe headers for non-Latin-1 names", () => {
    const h = fileResponseHeaders({ mimeType: "application/pdf", fileName: "Angebot Şahin 😀.pdf" });
    expect(() => new Headers(h)).not.toThrow();
    expect(h["Content-Disposition"]).toContain('filename="Angebot _ahin __.pdf"');
    expect(h["Content-Disposition"]).toContain(
      "filename*=UTF-8''Angebot%20%C5%9Eahin%20%F0%9F%98%80.pdf"
    );
  });

  it("sanitizes quotes and backslashes in the fallback name", () => {
    const h = fileResponseHeaders({ mimeType: "application/pdf", fileName: 'a"b\\c.pdf' });
    expect(h["Content-Disposition"]).toContain('filename="a_b_c.pdf"');
  });
});
