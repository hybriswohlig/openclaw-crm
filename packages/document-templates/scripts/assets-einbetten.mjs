// Schreibt Schriften und Logos aus assets/ als base64-Module nach src/marke/.
// So landen sie sicher im Server-Bundle, ohne Dateizugriff zur Laufzeit.
// Aufruf aus packages/document-templates: node scripts/assets-einbetten.mjs
//
// Schriften: statische TTFs von Google Fonts, mit pyftsubset auf Latin und
// Latin-Ext-A plus Satzzeichen verkleinert (Lizenzen in assets/schriften/OFL-*.txt).
// Logos: aus der SVG der Firma mit headless Chrome als PNG gerendert und beschnitten.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const b64 = (rel) => fs.readFileSync(path.join(root, "assets", rel)).toString("base64");
const kopf = "// Erzeugt von scripts/assets-einbetten.mjs. Nicht von Hand ändern.\n";

fs.mkdirSync(path.join(root, "src/marke"), { recursive: true });
fs.writeFileSync(
  path.join(root, "src/marke/schriften.ts"),
  kopf +
    `export const INTER_REGULAR = "${b64("schriften/Inter-Regular.ttf")}";\n` +
    `export const INTER_SEMIBOLD = "${b64("schriften/Inter-SemiBold.ttf")}";\n` +
    `export const JAKARTA_EXTRABOLD = "${b64("schriften/PlusJakartaSans-ExtraBold.ttf")}";\n`,
);
fs.writeFileSync(
  path.join(root, "src/marke/logos.ts"),
  kopf + `/** PNG je Firmen-Slug. */\nexport const LOGO_PNG: Record<string, string> = {\n  kottke: "${b64("logo-kottke.png")}",\n};\n`,
);
console.log("src/marke/schriften.ts und src/marke/logos.ts geschrieben");
