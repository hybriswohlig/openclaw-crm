import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCrmTools } from "./register-tools";
import {
  casePaths,
  definitionDescriptions,
  definitionNames,
  findParityMismatches,
  findStaleExemptions,
  stripComments,
  switchCases,
} from "./registry-introspect";
import {
  CRM_TOOL_NAMES,
  LEGACY_DESCRIPTION_DRIFT,
  STDIO_ONLY_TOOL_NAMES,
  TOOLS_AT_GUARD_CREATION,
  TOOLS_WITHOUT_FIXED_PATH,
  WEB_ONLY_TOOL_NAMES,
} from "./tool-names";

/**
 * Read a repo file relative to this test.
 *
 * The stdio registry lives in a different package with its own tsconfig, so
 * it is read as text rather than imported — the guard must not drag
 * apps/mcp into the web app's type-check graph.
 */
function readRelative(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

const DISPATCH = readRelative("./dispatch.ts");
const STDIO_DEFS = readRelative("../../../../mcp/src/tools/definitions.ts");
const STDIO_HANDLERS = readRelative("../../../../mcp/src/tools/handlers.ts");

/**
 * Names and descriptions the zod registry actually registers.
 *
 * `registerCrmTools` only ever calls `server.tool(name, description, …)`, so
 * a recorder with that one method is a faithful stand-in and needs no SDK
 * server. Reading the description off the call rather than out of the source
 * means it is the evaluated value, not a regex's guess at one.
 */
function webRegistry(): Map<string, string> {
  const out = new Map<string, string>();
  const recorder = {
    tool(name: string, description: string) {
      out.set(name, description);
    },
  };
  registerCrmTools(recorder as unknown as McpServer);
  return out;
}

const sorted = (names: readonly string[]) => [...names].sort();

/** Names that must agree between the two registries. */
function sharedNames(): string[] {
  const webOnly = WEB_ONLY_TOOL_NAMES as readonly string[];
  return CRM_TOOL_NAMES.filter((n) => !webOnly.includes(n));
}

describe("MCP tool-name drift guard", () => {
  it("has no duplicate names", () => {
    expect(sorted(CRM_TOOL_NAMES)).toEqual(sorted([...new Set(CRM_TOOL_NAMES)]));
  });

  it("the web zod registry exposes exactly CRM_TOOL_NAMES", () => {
    expect(sorted([...webRegistry().keys()])).toEqual(sorted(CRM_TOOL_NAMES));
  });

  it("the web dispatch switch handles exactly CRM_TOOL_NAMES", () => {
    expect(sorted(switchCases(DISPATCH))).toEqual(sorted(CRM_TOOL_NAMES));
  });

  it("the stdio definitions expose CRM_TOOL_NAMES minus the frozen exceptions", () => {
    // Spread rather than concat: the two const arrays have disjoint literal
    // unions, and concat would not type-check across them.
    const expected: string[] = [...sharedNames(), ...STDIO_ONLY_TOOL_NAMES];
    expect(sorted(definitionNames(STDIO_DEFS))).toEqual(sorted(expected));
  });

  it("the stdio handlers switch matches the stdio definitions", () => {
    expect(sorted(switchCases(STDIO_HANDLERS))).toEqual(
      sorted(definitionNames(STDIO_DEFS))
    );
  });

  it("keeps the legacy web-only list frozen at its 12 entries", () => {
    // This list is the drift that already existed when the guard was added.
    // It may only ever shrink: a NEW tool that lands in one registry is the
    // exact failure this guard exists to catch, so do not add to it.
    expect(WEB_ONLY_TOOL_NAMES).toHaveLength(12);
  });

  it("keeps TOOLS_AT_GUARD_CREATION frozen at its original 71 entries (M1)", () => {
    // M1: nothing else pins this array's length or its contents, so a
    // contributor could add a new tool to one registry with three edits —
    // append the name to CRM_TOOL_NAMES, append it to WEB_ONLY_TOOL_NAMES
    // (or LEGACY_DESCRIPTION_DRIFT), bump a `toHaveLength` here — and the
    // "only excepts names that predate the guard" tests below would never
    // catch it, because they check membership in THIS array. Length alone
    // would not catch a same-length edit (one entry swapped for another,
    // or reordered); the hash pins the exact content too.
    expect(TOOLS_AT_GUARD_CREATION).toHaveLength(71);
    const hash = createHash("sha256")
      .update(JSON.stringify(TOOLS_AT_GUARD_CREATION))
      .digest("hex");
    expect(hash).toBe(
      "3127e1e0191e9f5b9b1f0a20b064dd6191ace3250e0b006d76db8c02552ab014"
    );
  });

  it("only excepts web-only tools that predate the guard", () => {
    // The ratchet: WEB_ONLY_TOOL_NAMES exists to freeze drift that was
    // already there when the guard was created. A tool added after that
    // point — including everything this phase adds — is not eligible, no
    // matter how the exception list is edited, because it cannot be a member
    // of a set that was closed before it existed.
    const guardSet = new Set<string>(TOOLS_AT_GUARD_CREATION);
    const strays = WEB_ONLY_TOOL_NAMES.filter((n) => !guardSet.has(n));
    expect(strays).toEqual([]);
  });

  it("no longer knows crm_tasks_pulse anywhere", () => {
    expect(CRM_TOOL_NAMES).not.toContain("crm_tasks_pulse");
    expect(DISPATCH).not.toContain("crm_tasks_pulse");
    expect(STDIO_DEFS).not.toContain("crm_tasks_pulse");
  });
});

describe("MCP description parity", () => {
  it("gives every shared tool the same description in both registries", () => {
    // The likelier drift by far: same name, different guidance. An agent on
    // stdio then gets told something the HTTP agent is not, and the two
    // behave differently on the same CRM.
    const web = webRegistry();
    const stdio = definitionDescriptions(STDIO_DEFS);

    expect(findParityMismatches(web, stdio, LEGACY_DESCRIPTION_DRIFT)).toEqual(
      []
    );
  });

  it("keeps the legacy description-drift list frozen at its 40 entries", () => {
    // Same rule as WEB_ONLY_TOOL_NAMES: shrink it by rewriting the stdio
    // description to match, never grow it to silence a new mismatch.
    // Dropped from 42 to 40 by I8: crm_list_tasks and crm_update_task came
    // out once commit 4c1831c made their descriptions byte-identical.
    expect(LEGACY_DESCRIPTION_DRIFT).toHaveLength(40);
  });

  it("fails when an exempted description pair has quietly started to agree (I8)", () => {
    // findParityMismatches only ever SKIPS an exempted name — it never
    // re-checks whether the exemption is still earned, so a healed
    // mismatch (the stdio description was rewritten to match, or vice
    // versa) is invisible to it forever. crm_list_tasks and crm_update_task
    // sat on this list after commit 4c1831c made them byte-identical, and
    // nothing failed until this test existed. Every remaining entry here
    // must still actually diverge.
    const web = webRegistry();
    const stdio = definitionDescriptions(STDIO_DEFS);
    expect(findStaleExemptions(web, stdio, LEGACY_DESCRIPTION_DRIFT)).toEqual(
      []
    );
  });

  it("only exempts names that really are shared tools", () => {
    // A typo in the exemption list would silently exempt nothing and let a
    // real mismatch through, because the filter would never match it.
    const shared = new Set(sharedNames());
    const strays = (LEGACY_DESCRIPTION_DRIFT as readonly string[]).filter(
      (n) => !shared.has(n)
    );
    expect(strays).toEqual([]);
  });

  it("only excepts descriptions that predate the guard", () => {
    // Same ratchet as WEB_ONLY_TOOL_NAMES: this phase's 31 new tools land
    // with matching descriptions by construction (they are copy-pasted
    // verbatim between the two registries), so none of them may appear here.
    const guardSet = new Set<string>(TOOLS_AT_GUARD_CREATION);
    const strays = LEGACY_DESCRIPTION_DRIFT.filter((n) => !guardSet.has(n));
    expect(strays).toEqual([]);
  });
});

describe("MCP route parity", () => {
  it("points both registries at the same REST path for every shared tool", () => {
    // A dispatch case that reaches a different route in the two registries
    // is invisible until an agent gets the Next.js HTML shell back.
    const web = casePaths(DISPATCH);
    const stdio = casePaths(STDIO_HANDLERS);

    expect(
      findParityMismatches(web, stdio, TOOLS_WITHOUT_FIXED_PATH)
    ).toEqual([]);
  });

  it("only excepts tools that predate the guard from the fixed-path check", () => {
    const guardSet = new Set<string>(TOOLS_AT_GUARD_CREATION);
    const strays = TOOLS_WITHOUT_FIXED_PATH.filter((n) => !guardSet.has(n));
    expect(strays).toEqual([]);
  });

  it("finds a REST path for every tool that is not on the allowlist", () => {
    // Catches a registered case that never calls client.request at all.
    const web = casePaths(DISPATCH);
    const exempt = TOOLS_WITHOUT_FIXED_PATH as readonly string[];
    const missing = CRM_TOOL_NAMES.filter(
      (n) => !exempt.includes(n) && !web.has(n)
    );
    expect(missing).toEqual([]);
  });

  it("every path starts at /api/", () => {
    for (const [tool, path] of casePaths(DISPATCH)) {
      expect(path, tool).toMatch(/^\/api\//);
    }
  });
});

describe("registry introspection helpers", () => {
  it("ignores a case label that only appears in a comment", () => {
    // The original guard used an unanchored /case "crm_…"/ over the raw
    // source, so a tool merely MENTIONED in a doc comment counted as
    // implemented and the name check passed with no branch behind it.
    const source = [
      "// case \"crm_ghost\": never implemented, see the ticket",
      "/* case \"crm_phantom\": also not real */",
      "switch (name) {",
      "  case \"crm_real\":",
      "    return client.request(\"/api/v1/real\");",
      "}",
    ].join("\n");

    expect(switchCases(source)).toEqual(["crm_real"]);
  });

  it("keeps string contents intact while blanking comments", () => {
    const source = 'const a = "http://x//y"; // trailing comment\nconst b = 1;';
    const stripped = stripComments(source);
    expect(stripped).toContain('"http://x//y"');
    expect(stripped).not.toContain("trailing comment");
    // Offsets are preserved so line numbers still line up in a failure.
    expect(stripped).toHaveLength(source.length);
  });

  it("reads the description that follows each ToolDef name", () => {
    const source = [
      "export const TOOLS: ToolDef[] = [",
      "  {",
      '    name: "crm_one",',
      '    description: "One line.",',
      "    inputSchema: { type: \"object\", properties: {} },",
      "  },",
      "  {",
      '    name: "crm_two",',
      "    description:",
      '      "Wrapped onto the next line, with a \\"quote\\" in it.",',
      "    inputSchema: { type: \"object\", properties: {} },",
      "  },",
      "];",
    ].join("\n");

    const map = definitionDescriptions(source);
    expect(map.get("crm_one")).toBe("One line.");
    expect(map.get("crm_two")).toBe('Wrapped onto the next line, with a "quote" in it.');
  });

  it("extracts the first /api path of a case and normalises interpolations", () => {
    const source = [
      "switch (name) {",
      "  case \"crm_plain\":",
      '    return client.request("/api/v1/plain");',
      "  case \"crm_templated\":",
      "    return client.request(",
      "      `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/phases`",
      "    );",
      "  case \"crm_nothing\": {",
      "    return { local: true };",
      "  }",
      "}",
    ].join("\n");

    const paths = casePaths(source);
    expect(paths.get("crm_plain")).toBe("/api/v1/plain");
    expect(paths.get("crm_templated")).toBe("/api/v1/projects/{}/phases");
    expect(paths.has("crm_nothing")).toBe(false);
  });
});

describe("findParityMismatches", () => {
  it("returns no mismatches on the real registries", () => {
    // Not a duplicate of the "MCP description/route parity" assertions above:
    // this proves the extracted comparison itself is clean on real input,
    // independent of which caller (descriptions or paths) drives it.
    const web = webRegistry();
    const stdio = definitionDescriptions(STDIO_DEFS);
    expect(findParityMismatches(web, stdio, LEGACY_DESCRIPTION_DRIFT)).toEqual(
      []
    );
  });

  it("reports a deliberately divergent description and a deliberately divergent path", () => {
    // The guard's actual regression proof. Unlike a hand-built `.not.toBe()`
    // between two independently-constructed maps (which is trivially true
    // and never exercises the guard's own comparison), this drives the exact
    // function both parity assertions call and shows it can fail — for a
    // description-shaped mismatch and a path-shaped mismatch alike, since
    // the function is agnostic to what the string values represent.
    const web = new Map([
      ["crm_one", "House style description."],
      ["crm_two", "/api/v1/deals/1/documents"],
      ["crm_three", "same on both sides"],
    ]);
    const stdio = new Map([
      ["crm_one", "Something else entirely."],
      ["crm_two", "/api/v1/deals/1/attachments"],
      ["crm_three", "same on both sides"],
    ]);

    const mismatches = findParityMismatches(web, stdio, []);

    expect(mismatches).toEqual([
      {
        tool: "crm_one",
        web: "House style description.",
        stdio: "Something else entirely.",
      },
      {
        tool: "crm_two",
        web: "/api/v1/deals/1/documents",
        stdio: "/api/v1/deals/1/attachments",
      },
    ]);
  });

  it("does not flag a name that is exempted", () => {
    const web = new Map([["crm_one", "A"]]);
    const stdio = new Map([["crm_one", "B"]]);
    expect(findParityMismatches(web, stdio, ["crm_one"])).toEqual([]);
  });

  it("ignores a name that is not shared by both maps", () => {
    const web = new Map([["crm_web_only", "A"]]);
    const stdio = new Map([["crm_stdio_only", "B"]]);
    expect(findParityMismatches(web, stdio, [])).toEqual([]);
  });
});

describe("findStaleExemptions", () => {
  it("flags an exempted name whose values now agree", () => {
    const web = new Map([["crm_one", "Same on both sides."]]);
    const stdio = new Map([["crm_one", "Same on both sides."]]);
    expect(findStaleExemptions(web, stdio, ["crm_one"])).toEqual(["crm_one"]);
  });

  it("does not flag an exemption that still genuinely diverges", () => {
    const web = new Map([["crm_one", "House style description."]]);
    const stdio = new Map([["crm_one", "Something else entirely."]]);
    expect(findStaleExemptions(web, stdio, ["crm_one"])).toEqual([]);
  });

  it("ignores an exempted name missing from either map", () => {
    const web = new Map([["crm_one", "A"]]);
    const stdio = new Map<string, string>();
    expect(findStaleExemptions(web, stdio, ["crm_one"])).toEqual([]);
  });

  it("ignores a name that is not in the exception list at all", () => {
    const web = new Map([["crm_one", "Same"]]);
    const stdio = new Map([["crm_one", "Same"]]);
    expect(findStaleExemptions(web, stdio, [])).toEqual([]);
  });
});
