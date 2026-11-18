import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Isolierte Vorschau des KV-Editors: node apps/web/e2e/kv-editor-preview/serve.mjs → http://127.0.0.1:4179
const require = createRequire(import.meta.url);
const vitePath = require.resolve("vite", { paths: [path.dirname(require.resolve("vitest/package.json"))] });
const { createServer } = await import(vitePath);
const { default: tailwind } = await import("@tailwindcss/postcss");
const root = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(root, "../..");

/** Einseitiges Test-PDF („KV, Stand …“), ohne Bibliothek. */
function testPdf(titel) {
  const text = titel.replace(/[()\\]/g, "");
  const inhalt = `BT /F1 22 Tf 60 760 Td (Kostenvoranschlag) Tj 0 -34 Td /F1 13 Tf (${text}) Tj 0 -22 Td (Testdaten, Alex Beispiel) Tj ET`;
  const objekte = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offs = [];
  objekte.forEach((o, i) => {
    offs.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const server = await createServer({
  configFile: false,
  root,
  define: { "process.env": "{}" },
  publicDir: path.join(web, "public"),
  resolve: { alias: [{ find: /^next\/link$/, replacement: path.join(root, "link-shim.tsx") }, { find: "@", replacement: path.join(web, "src") }] },
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [tailwind()] } },
  server: { host: "127.0.0.1", port: 4179, strictPort: true, fs: { allow: [path.resolve(web, "../..")] } },
  plugins: [
    {
      name: "test-pdf",
      configureServer(s) {
        s.middlewares.use("/vorschau.pdf", (req, res) => {
          const stand = new URL(req.url ?? "", "http://x").searchParams.get("stand") ?? "";
          res.setHeader("Content-Type", "application/pdf");
          res.end(testPdf(`Stand ${stand}`));
        });
      },
    },
  ],
});
await server.listen();
console.log("KV-Editor-Vorschau: http://127.0.0.1:4179/?szenario=standard");
