/**
 * Projekte an der tatsächlichen Geschäftsstruktur ausrichten.
 *
 * Die erste Migration hat die Projekte aus der Zuordnungstabelle der Spec
 * gebildet. Dario hat danach korrigiert, wie er sein Geschäft wirklich denkt:
 * Küchenmontage und Entrümpelung sind eigene Geschäftsfelder, SEO läuft
 * dauerhaft weiter statt mit dem Relaunch zu enden, neue Geschäftsfelder
 * (Hansetrans/GLS letzte Meile, Autohandel) sind etwas anderes als
 * Lead-Kanäle (Check24, Kleinanzeigen, BNI).
 *
 * DRY-RUN BY DEFAULT. Ohne --apply wird nichts geschrieben.
 *
 *   pnpm --filter @openclaw-crm/web tasks:reorganize            # Vorschau
 *   pnpm --filter @openclaw-crm/web tasks:reorganize --apply    # schreibt
 *
 * Wiederholbar: Projekte werden über den Namen gefunden, Aufgaben über ihren
 * Text — ein zweites --apply ändert nichts.
 *
 * NIEMALS `pnpm db:push` / `drizzle-kit push` in diesem Repo: das zielt
 * unabhängig von der gesetzten Variable auf die Produktionsdatenbank. Dieses
 * Skript fasst nur Zeilen an, kein DDL.
 */
import "./_load-env";
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema/tasks";
import { projects, projectMembers } from "@/db/schema/projects";
import { workspaces } from "@/db/schema/workspace";

const APPLY = process.argv.includes("--apply");

/** Neue Projekte. `category` muss ein Wert aus PROJECT_CATEGORIES sein. */
const NEUE_PROJEKTE = [
  {
    name: "Küchenmontage",
    shortDescription:
      "Küchenaufbau als eigenes Leistungsangebot: Preise, Material, Ablauf, Partner.",
    category: "leistung",
    priority: "hoch",
    icon: "Wrench",
    color: "#3b82f6",
  },
  {
    name: "Entrümpelungen als Geschäftsfeld",
    shortDescription:
      "Entrümpelung planmäßig aufbauen: Preise, Ablauf, Entsorgung, Vermarktung. Nicht einzelne Aufträge.",
    category: "leistung",
    priority: "hoch",
    icon: "Wrench",
    color: "#3b82f6",
  },
  {
    name: "SEO & Sichtbarkeit",
    shortDescription:
      "Laufende Sichtbarkeit: Rankings, Search Console, Bewertungen, Keyword-Recherche. Endet nicht mit dem Relaunch.",
    category: "marketing",
    priority: "hoch",
    icon: "Megaphone",
    color: "#8b5cf6",
  },
  {
    name: "Neue Geschäftsfelder prüfen",
    shortDescription:
      "Ideen bewerten, bevor investiert wird: letzte Meile (Hansetrans, GLS), Autohandel, Autoüberführungen.",
    category: "leistung",
    priority: "mittel",
    icon: "Wrench",
    color: "#3b82f6",
  },
  {
    name: "Akquise & Lead-Kanäle",
    shortDescription:
      "Woher die Aufträge kommen: Check24, Kleinanzeigen, BNI und Netzwerke, Hausverwaltungen.",
    category: "marketing",
    priority: "hoch",
    icon: "Megaphone",
    color: "#8b5cf6",
  },
] as const;

/**
 * Zuordnungen. `exact` trifft den ganzen Aufgabentext, `prefix` den Anfang,
 * `childrenOf` zieht alle Unteraufgaben einer Elternaufgabe mit — sonst
 * risse die Zuordnung eine Familie auseinander.
 */
const ZUORDNUNGEN: Array<{
  projekt: string;
  exact?: string[];
  prefix?: string[];
  childrenOf?: string[];
}> = [
  {
    projekt: "Küchenmontage",
    prefix: ["Mit Artur Kosten für Küchenaufbau besprechen"],
  },
  {
    projekt: "Entrümpelungen als Geschäftsfeld",
    exact: ["Entrümpelungen neues Geschäftsfeld"],
  },
  {
    projekt: "SEO & Sichtbarkeit",
    exact: ["SEO/GEO kottke-umzuege.de", "Google-Bewertungslink Beide rein"],
    prefix: [
      "Tracker im CRM für Google-Search-Entwicklung",
      "Jobcenter-Aufträge: Google-Suchbegriffe",
    ],
  },
  {
    projekt: "Neue Geschäftsfelder prüfen",
    exact: [
      "Autoüberführungen als neues Geschäft prüfen",
      "Autohandel als neues Geschäftsfeld",
    ],
    prefix: ["Letzte-Meile-Lieferung prüfen (Referenz HANSETRANS)"],
    childrenOf: ["Autoüberführungen als neues Geschäft prüfen"],
  },
  {
    projekt: "Akquise & Lead-Kanäle",
    exact: [
      "Vergleich Kleinanzeigen Pro vs non-pro",
      "Check24 checken und Preise erhöhen",
      "Kottke Dienstleistungen Anzeige (Kleinanzeigen)",
      "Neue Kleinanzeigen",
      "Stuttgart, Tübingen, Pforzheim Kleinanzeigen",
      "Email Curler for Kleinanzeigen",
      "https://bni-stuttgart.com/neptun/de/index",
    ],
    prefix: ["Analyse von Check24"],
    childrenOf: ["Vergleich Kleinanzeigen Pro vs non-pro"],
  },
  {
    // Bestehendes Projekt — die beiden Kalkulatoren lagen unter „sonstiges".
    projekt: "IT-Transformation",
    exact: ["Kostenkalkulator", "Internet Kostenkalkulator"],
  },
];

function id() {
  return crypto.randomUUID();
}

async function main() {
  const ws = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
  const workspaceId = ws[0]?.id;
  if (!workspaceId) throw new Error("Kein Workspace gefunden.");

  const owner = await db
    .select({ ownerUserId: projects.ownerUserId })
    .from(projects)
    .where(sql`${projects.ownerUserId} is not null`)
    .limit(1);
  const ownerUserId = owner[0]?.ownerUserId ?? null;

  const alleAufgaben = await db
    .select({
      id: tasks.id,
      content: tasks.content,
      kind: tasks.kind,
      area: tasks.area,
      projectId: tasks.projectId,
      parentTaskId: tasks.parentTaskId,
      isCompleted: tasks.isCompleted,
    })
    .from(tasks)
    .where(eq(tasks.workspaceId, workspaceId));

  const byId = new Map(alleAufgaben.map((t) => [t.id, t]));
  const vorhandeneProjekte = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId));
  const projektIdByName = new Map(vorhandeneProjekte.map((p) => [p.name, p.id]));

  // ── 0. Sicherung ───────────────────────────────────────────────────
  // Vor jedem Schreibvorgang: der vollständige Vorzustand jeder Aufgabe, die
  // dieses Skript anfassen könnte. Ohne das wäre die Umstrukturierung nicht
  // umkehrbar — die erste Migration hatte dafür eine Sicherung, diese hier
  // muss ihre eigene schreiben.
  if (APPLY) {
    const dir = path.resolve(__dirname, "../.migration-backups");
    fs.mkdirSync(dir, { recursive: true });
    const datei = path.join(
      dir,
      `reorganize-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    fs.writeFileSync(
      datei,
      JSON.stringify(
        { createdAt: new Date().toISOString(), workspaceId, tasksBefore: alleAufgaben },
        null,
        2,
      ),
    );
    console.log(`\nSicherung geschrieben: ${datei}`);
  }

  // ── 1. Projekte anlegen ────────────────────────────────────────────
  const anzulegen = NEUE_PROJEKTE.filter((p) => !projektIdByName.has(p.name));
  console.log("\n── Projekte ────────────────────────────────────────────────");
  for (const p of NEUE_PROJEKTE) {
    const da = projektIdByName.has(p.name);
    console.log(`  ${da ? "bereits da " : "ANLEGEN    "} ${p.name}`);
  }

  if (APPLY) {
    for (const p of anzulegen) {
      const neu = id();
      await db.insert(projects).values({
        id: neu,
        workspaceId,
        name: p.name,
        shortDescription: p.shortDescription,
        category: p.category,
        priority: p.priority,
        status: "aktiv",
        icon: p.icon,
        color: p.color,
        ownerUserId,
        createdBy: ownerUserId,
      });
      if (ownerUserId) {
        await db.insert(projectMembers).values({
          id: id(),
          workspaceId,
          projectId: neu,
          userId: ownerUserId,
          role: "leiter",
        });
      }
      projektIdByName.set(p.name, neu);
    }
  }

  // ── 2. Aufgaben zuordnen ───────────────────────────────────────────
  console.log("\n── Zuordnungen ─────────────────────────────────────────────");
  let geplant = 0;
  const proProjekt = new Map<string, string[]>();

  for (const z of ZUORDNUNGEN) {
    const treffer = new Set<string>();
    for (const t of alleAufgaben) {
      if (z.exact?.includes(t.content)) treffer.add(t.id);
      if (z.prefix?.some((p) => t.content.startsWith(p))) treffer.add(t.id);
    }
    for (const elternText of z.childrenOf ?? []) {
      const eltern = alleAufgaben.find((t) => t.content === elternText);
      if (!eltern) continue;
      for (const t of alleAufgaben) {
        if (t.parentTaskId === eltern.id) treffer.add(t.id);
      }
    }

    const zielId = projektIdByName.get(z.projekt) ?? null;
    const liste: string[] = [];
    for (const tid of treffer) {
      const t = byId.get(tid)!;
      if (t.kind === "projekt" && t.projectId === zielId) continue; // schon dort
      liste.push(t.content);
      geplant += 1;
      if (APPLY && zielId) {
        await db
          .update(tasks)
          .set({ kind: "projekt", area: null, projectId: zielId })
          .where(and(eq(tasks.id, tid), eq(tasks.workspaceId, workspaceId)));
      }
    }
    proProjekt.set(z.projekt, liste);
  }

  for (const [projekt, liste] of proProjekt) {
    if (liste.length === 0) continue;
    console.log(`\n  ${projekt}  (${liste.length})`);
    for (const c of liste) console.log(`    · ${c.slice(0, 70)}`);
  }

  // ── 3. Verwaiste Elternverweise leeren ─────────────────────────────
  const waisen = alleAufgaben.filter(
    (t) => t.parentTaskId !== null && !byId.has(t.parentTaskId),
  );
  console.log("\n── Unsichtbare Aufgaben ────────────────────────────────────");
  if (waisen.length === 0) {
    console.log("  keine");
  } else {
    for (const w of waisen) {
      console.log(`  sichtbar machen: ${w.content.slice(0, 60)}`);
    }
    if (APPLY) {
      await db
        .update(tasks)
        .set({ parentTaskId: null })
        .where(
          and(
            eq(tasks.workspaceId, workspaceId),
            inArray(
              tasks.id,
              waisen.map((w) => w.id),
            ),
          ),
        );
    }
  }

  console.log("\n── Zusammenfassung ─────────────────────────────────────────");
  console.table([
    {
      Projekte_angelegt: APPLY ? anzulegen.length : anzulegen.length,
      Aufgaben_zugeordnet: geplant,
      Sichtbar_gemacht: waisen.length,
    },
  ]);

  if (!APPLY) {
    console.log("\nDRY-RUN — es wurde nichts geschrieben.");
    console.log("Zuordnung prüfen, dann mit --apply ausführen.\n");
  } else {
    console.log("\nFertig.\n");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("reorganize-projects fehlgeschlagen:", err);
    process.exit(1);
  });
