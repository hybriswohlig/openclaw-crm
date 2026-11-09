import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ALTE_ORDNER, neuImportiertAlt } from "../../../scripts/alt-importe";

const SRC = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");

/** Schlüssel wie der Wächter sie vergleicht. */
function schluessel(e: { datei: string; import: string }): string {
  return `${e.datei} → ${e.import}`;
}

function bestandVergleich(
  ist: { datei: string; import: string }[],
  bestand: { datei: string; import: string }[]
): { neu: string[]; weg: string[] } {
  const istKeys = ist.map(schluessel);
  const bestandKeys = bestand.map(schluessel);
  const istSet = new Set(istKeys);
  const bestandSet = new Set(bestandKeys);
  return {
    neu: istKeys.filter((k) => !bestandSet.has(k)),
    weg: bestandKeys.filter((k) => !istSet.has(k)),
  };
}

/**
 * Heute bekannte Importe der neuen Welt aus alten Modulen.
 * Jeder Eintrag bleibt, bis der Baustein in `components/neu` (oder `lib`) liegt.
 */
const BESTAND: { datei: string; import: string }[] = [
  // Hintergrundjobs der alten Schale, Provider um die neue Oberfläche.
  { datei: "app/(neu)/layout.tsx", import: "@/components/background-jobs" },
  // Freigabe-Schranke, noch die Komponente der alten Schale.
  { datei: "app/(neu)/layout.tsx", import: "@/components/layout/approval-gate" },
  // Dokumentdialog der alten Oberfläche (AB, Rechnung), von der Akte benutzt.
  { datei: "components/neu/akte/dokument-dialog.tsx", import: "@/components/GenerateDocumentDialog" },
  // Terminvorschläge des Kundenlinks: Hülle um den alten Composer.
  { datei: "components/neu/akte/termin-dialog-alt.tsx", import: "@/components/customer-link/date-offer-composer" },
  // Plan 10: Ladebild der Lagekarte.
  { datei: "components/neu/heute/lagekarte-ansicht.tsx", import: "@/components/lagekarte/ladebild" },
  // Plan 10: Lagekarte selbst, dynamisch geladen.
  { datei: "components/neu/heute/lagekarte-ansicht.tsx", import: "@/components/lagekarte/lagekarte" },
  // Plan 10: Kurztext (renderSnippet) aus dem alten Composer.
  { datei: "components/neu/inbox/inbox-logik.ts", import: "@/components/inbox/customer-link-composer" },
  // Plan 10: Verfassen-Dialog (WhatsApp) der alten Inbox.
  { datei: "components/neu/inbox/inbox-seite.tsx", import: "@/components/inbox/compose-whatsapp-modal" },
  // WhatsApp-Hinweis der alten Schale im neuen Banner.
  { datei: "components/neu/shell-banner.tsx", import: "@/components/layout/whatsapp-status-banner" },
  // Typ PrefilledPreise aus dem alten Dokumentdialog.
  { datei: "lib/angebot-vorbelegung.ts", import: "@/components/GenerateDocumentDialog" },
  // Typen DealData und Firma aus dem alten Dokumentdialog.
  { datei: "lib/deal-doc-data.ts", import: "@/components/GenerateDocumentDialog" },
];

describe("Import-Wächter der neuen Oberfläche", () => {
  const ist = neuImportiertAlt(SRC);

  it("meldet keine neuen Importe alter Module", () => {
    const { neu } = bestandVergleich(ist, BESTAND);
    expect(
      neu,
      `Neue Oberfläche importiert alte Module: ${neu.join(", ")} (Baustein verschieben oder in den Bestand mit Grund)`
    ).toEqual([]);
  });

  it("führt keinen Bestand, den es nicht mehr gibt", () => {
    const { weg } = bestandVergleich(ist, BESTAND);
    expect(weg, `Bestand aufräumen: ${weg.join(", ")}`).toEqual([]);
  });

  it("vergleicht als Menge: ein zusätzlicher Fund ist neu, ein fehlender aufzuräumen", () => {
    const a = { datei: "a.ts", import: "@/components/inbox/x" };
    const b = { datei: "b.ts", import: "@/components/inbox/y" };
    expect(bestandVergleich([a, b], [a])).toEqual({ neu: [schluessel(b)], weg: [] });
    expect(bestandVergleich([a], [a, b])).toEqual({ neu: [], weg: [schluessel(b)] });
    expect(bestandVergleich([a], [a])).toEqual({ neu: [], weg: [] });
  });
});

describe("ALTE_ORDNER", () => {
  it("nimmt app/(dashboard) und alte Komponenten, nicht die Ausnahmen", () => {
    expect(ALTE_ORDNER[0]).toBe("@/app/(dashboard)/");
    for (const name of ["inbox", "quotation", "layout", "home", "lagekarte", "financial", "auftrag", "media", "deal-insights", "background-jobs", "customer-link"]) {
      expect(ALTE_ORDNER).toContain(`@/components/${name}`);
    }
    for (const aus of ["neu", "glassyui", "ui", "analytics", "pwa", "theme-provider"]) {
      expect(ALTE_ORDNER).not.toContain(`@/components/${aus}`);
    }
  });
});

describe("neuImportiertAlt auf einem Temp-Verzeichnis", () => {
  let src: string;

  afterEach(() => {
    if (src) rmSync(src, { recursive: true, force: true });
  });

  function datei(rel: string, inhalt: string) {
    const voll = path.join(src, rel);
    mkdirSync(path.dirname(voll), { recursive: true });
    writeFileSync(voll, inhalt);
  }

  it("findet statische, exportierte, dynamische, relative und Nur-Typ-Importe und übergeht Testdateien", () => {
    src = mkdtempSync(path.join(tmpdir(), "alt-importe-"));
    datei("components/inbox/alt.ts", "export const x = 1;\nexport type X = number;\n");
    datei("components/ui/button.ts", "export const Button = 1;\n");
    datei("components/theme-provider.tsx", "export const Theme = 1;\n");
    datei(
      "components/neu/statisch.tsx",
      `import {\n  AltDing,\n} from "@/components/inbox/alt";\nexport const y = AltDing;\n`
    );
    datei("components/neu/weiter.ts", `export { x } from "@/components/inbox/alt";\n`);
    datei(
      "components/neu/dynamisch.ts",
      `export const laden = () => import("@/components/inbox/alt");\n`
    );
    datei("components/neu/relativ.tsx", `import { x } from "../inbox/alt";\nexport const y = x;\n`);
    datei("components/neu/nur-typ.ts", `import type { X } from "@/components/inbox/alt";\nexport type Y = X;\n`);
    datei("components/neu/ignoriert.test.ts", `import { x } from "@/components/inbox/alt";\nexport const y = x;\n`);
    datei(
      "components/neu/sauber.tsx",
      [
        `import { Button } from "@/components/ui/button";`,
        `import { Theme } from "@/components/theme-provider";`,
        `import { y } from "@/components/neu/statisch";`,
        `// import { x } from "@/components/inbox/alt";`,
        `const hinweis = "import { x } from \\"@/components/inbox/alt\\"";`,
        `export const z = Button ?? Theme ?? y ?? hinweis;`,
        "",
      ].join("\n")
    );
    datei("app/(neu)/dash.tsx", `import { x } from "@/app/(dashboard)/home/page";\nexport const y = x;\n`);
    datei("lib/auch.ts", `import { x } from "@/components/neu/statisch";\nexport const y = x;\n`);
    datei("services/job.ts", `export const job = 1;\n`);

    expect(neuImportiertAlt(src)).toEqual([
      { datei: "app/(neu)/dash.tsx", import: "@/app/(dashboard)/home/page" },
      { datei: "components/neu/dynamisch.ts", import: "@/components/inbox/alt" },
      { datei: "components/neu/nur-typ.ts", import: "@/components/inbox/alt" },
      { datei: "components/neu/relativ.tsx", import: "../inbox/alt" },
      { datei: "components/neu/statisch.tsx", import: "@/components/inbox/alt" },
      { datei: "components/neu/weiter.ts", import: "@/components/inbox/alt" },
    ]);
  });
});
