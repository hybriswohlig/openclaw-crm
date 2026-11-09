/**
 * Plan 14, Task L: welche Dateien der neuen Oberfläche noch alte Module importieren.
 * Rein: node:fs und node:path, keine Datenbank.
 *
 * Nicht alt (bleiben): die Ordner `neu`, `glassyui`, `ui`, `analytics`, `pwa`
 * und die Datei `theme-provider` direkt unter `components`. Jeder andere Ordner
 * und jede andere Moduldatei direkt unter `components` gilt als alte Oberfläche,
 * dazu alles unter `app/(dashboard)`. Relative Importe, die dort landen, zählen mit.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AUSGENOMMEN = new Set(["neu", "glassyui", "ui", "analytics", "pwa", "theme-provider"]);

const QUELL_WURZELN = ["components/neu", "app/(neu)", "lib", "services"] as const;

function alteNamen(srcDir: string): string[] {
  const basis = path.join(srcDir, "components");
  if (!existsSync(basis)) return [];
  const namen = new Set<string>();
  for (const name of readdirSync(basis)) {
    if (name.includes(".test.")) continue;
    const voll = path.join(basis, name);
    const art = statSync(voll);
    if (art.isDirectory()) {
      if (!AUSGENOMMEN.has(name)) namen.add(name);
      continue;
    }
    const stamm = name.replace(/\.(tsx|ts|jsx|js)$/, "");
    if (stamm === name || AUSGENOMMEN.has(stamm)) continue;
    namen.add(stamm);
  }
  return [...namen].sort();
}

/** Import-Spezifizierer, die als alt gelten. Aus dem Dateisystem von `apps/web/src`. */
export const ALTE_ORDNER: readonly string[] = [
  "@/app/(dashboard)/",
  ...alteNamen(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src")).map((n) => `@/components/${n}`),
];

function ohneKommentare(quelle: string): string {
  let raus = "";
  let i = 0;
  let str: "'" | '"' | "`" | null = null;
  while (i < quelle.length) {
    const c = quelle[i];
    const n = quelle[i + 1];
    if (str) {
      raus += c;
      if (c === "\\") {
        raus += n ?? "";
        i += 2;
        continue;
      }
      if (c === str) str = null;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      const nl = quelle.indexOf("\n", i);
      i = nl < 0 ? quelle.length : nl;
      continue;
    }
    if (c === "/" && n === "*") {
      const ende = quelle.indexOf("*/", i + 2);
      i = ende < 0 ? quelle.length : ende + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") str = c;
    raus += c;
    i++;
  }
  return raus;
}

/** Statische Importe, `export … from` und `import()`. */
export function importSpezifizierer(quelle: string): string[] {
  const text = ohneKommentare(quelle);
  const specs: string[] = [];
  for (const m of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);

  const stmt = /(?:^|[;\n])\s*(import|export)\b/g;
  let m: RegExpExecArray | null;
  while ((m = stmt.exec(text))) {
    const kw = m[1];
    const kwBei = m.index + m[0].length - kw.length;
    const nach = text.slice(kwBei + kw.length);
    if (kw === "import" && /^\s*[.(]/.test(nach)) continue;

    let i = kwBei + kw.length;
    let depth = 0;
    let spec: string | null = null;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "'" || c === '"') {
        const q = c;
        let inhalt = "";
        let j = i + 1;
        for (; j < text.length; j++) {
          if (text[j] === "\\") {
            inhalt += text[j + 1] ?? "";
            j++;
            continue;
          }
          if (text[j] === q) break;
          inhalt += text[j];
        }
        const davor = text.slice(kwBei, i).replace(/\s+$/, "");
        if (depth === 0 && /(?:\bfrom|\bimport|\bexport)$/.test(davor)) {
          spec = inhalt;
          i = j;
          break;
        }
        i = j;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") depth = Math.max(0, depth - 1);
      else if (c === "(") depth++;
      else if (c === ")") depth = Math.max(0, depth - 1);
      else if (c === ";" && depth === 0) break;
    }
    if (spec) specs.push(spec);
    stmt.lastIndex = Math.max(stmt.lastIndex, i);
  }
  return specs;
}

function stamm(segment: string): string {
  return segment.replace(/\.(tsx|ts|jsx|js)$/, "");
}

function istAlt(spec: string, dateiAbs: string, srcDir: string, alte: Set<string>): boolean {
  const nackt = spec.split(/[?#]/)[0];
  if (nackt === "@/app/(dashboard)" || nackt.startsWith("@/app/(dashboard)/")) return true;
  if (nackt.startsWith("@/components/")) {
    const erstes = stamm(nackt.slice("@/components/".length).split("/")[0]);
    return alte.has(erstes);
  }
  if (!nackt.startsWith(".")) return false;
  const ziel = path.resolve(path.dirname(dateiAbs), nackt);
  const rel = path.relative(srcDir, ziel).split(path.sep).join("/");
  if (rel === "app/(dashboard)" || rel.startsWith("app/(dashboard)/")) return true;
  if (!rel.startsWith("components/")) return false;
  const erstes = stamm(rel.slice("components/".length).split("/")[0]);
  return alte.has(erstes);
}

function quellDateien(wurzel: string): string[] {
  if (!existsSync(wurzel)) return [];
  const raus: string[] = [];
  const stapel = [wurzel];
  while (stapel.length) {
    const dir = stapel.pop();
    if (!dir) break;
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const voll = path.join(dir, name);
      const art = statSync(voll);
      if (art.isDirectory()) stapel.push(voll);
      else if (/\.tsx?$/.test(name) && !name.includes(".test.")) raus.push(voll);
    }
  }
  return raus;
}

/** Jeder Import eines alten Moduls aus der neuen Oberfläche, sortiert. */
export function neuImportiertAlt(srcDir: string): { datei: string; import: string }[] {
  const alte = new Set(alteNamen(srcDir));
  const funde: { datei: string; import: string }[] = [];
  for (const wurzel of QUELL_WURZELN) {
    for (const dateiAbs of quellDateien(path.join(srcDir, wurzel))) {
      const text = readFileSync(dateiAbs, "utf8");
      const gesehen = new Set<string>();
      for (const spec of importSpezifizierer(text)) {
        if (gesehen.has(spec) || !istAlt(spec, dateiAbs, srcDir, alte)) continue;
        gesehen.add(spec);
        funde.push({
          datei: path.relative(srcDir, dateiAbs).split(path.sep).join("/"),
          import: spec,
        });
      }
    }
  }
  funde.sort((a, b) => (a.datei < b.datei ? -1 : a.datei > b.datei ? 1 : a.import < b.import ? -1 : a.import > b.import ? 1 : 0));
  return funde;
}
