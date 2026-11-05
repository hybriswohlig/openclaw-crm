// Schreibt Schriften und Logos aus assets/ als base64-Module nach src/marke/.
// So landen sie sicher im Server-Bundle, ohne Dateizugriff zur Laufzeit.
// Aufruf aus packages/document-templates: node scripts/assets-einbetten.mjs
//
// Schriften: statische TTFs von Google Fonts, mit pyftsubset auf Latin und
// Latin-Ext-A plus Satzzeichen verkleinert (Lizenzen in assets/schriften/OFL-*.txt).
// Logos: K-Logos der Firma, Weiß per Farbe-zu-Alpha freigestellt, beschnitten, 900 px, Palette (96 Farben).
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
  kopf +
    `/** PNG je Firma, mit ":<Leistung>" je Leistung (move, clearance, kitchen_installation). */\n` +
    `export const LOGO_PNG: Record<string, string> = {\n` +
    `  kottke: "${b64("kottke.png")}",\n` +
    `  "kottke:move": "${b64("kottke-umzuege.png")}",\n` +
    `  "kottke:clearance": "${b64("kottke-entruempelung.png")}",\n` +
    `  "kottke:kitchen_installation": "${b64("kottke-kuechen.png")}",\n` +
    `};\n`,
);
console.log("src/marke/schriften.ts und src/marke/logos.ts geschrieben");
