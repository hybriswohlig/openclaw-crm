import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCrmTools } from "./register-tools";
import {
  casePaths,
  definitionDescriptions,
  definitionNames,
  stripComments,
  switchCases,
} from "./registry-introspect";
import {
  CRM_TOOL_NAMES,
  LEGACY_DESCRIPTION_DRIFT,
  STDIO_ONLY_TOOL_NAMES,
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
    const exempt = LEGACY_DESCRIPTION_DRIFT as readonly string[];

    const mismatches = sharedNames()
      .filter((n) => !exempt.includes(n))
      .filter((n) => web.get(n) !== stdio.get(n));

    expect(mismatches).toEqual([]);
  });

  it("keeps the legacy description-drift list frozen at its 42 entries", () => {
    // Same rule as WEB_ONLY_TOOL_NAMES: shrink it by rewriting the stdio
    // description to match, never grow it to silence a new mismatch.
    expect(LEGACY_DESCRIPTION_DRIFT).toHaveLength(42);
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
});

describe("MCP route parity", () => {
  it("points both registries at the same REST path for every shared tool", () => {
    // A dispatch case that reaches a different route in the two registries
    // is invisible until an agent gets the Next.js HTML shell back.
    const web = casePaths(DISPATCH);
    const stdio = casePaths(STDIO_HANDLERS);
    const exempt = TOOLS_WITHOUT_FIXED_PATH as readonly string[];

    const mismatches = sharedNames()
      .filter((n) => !exempt.includes(n))
      .map((n) => ({ tool: n, web: web.get(n), stdio: stdio.get(n) }))
      .filter((row) => row.web !== row.stdio);

    expect(mismatches).toEqual([]);
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

  it("fails the parity check on a deliberately mismatched description", () => {
    // The guard's own regression test: prove the comparison can fail.
    const web = new Map([["crm_one", "House style description."]]);
    const stdio = definitionDescriptions(
      [
        "  {",
        '    name: "crm_one",',
        '    description: "Something else entirely.",',
        "  },",
      ].join("\n")
    );
    expect(web.get("crm_one")).not.toBe(stdio.get("crm_one"));
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

  it("catches two registries pointing at different routes", () => {
    const a = casePaths(
      '  case "crm_x":\n    return client.request("/api/v1/deals/1/documents");'
    );
    const b = casePaths(
      '  case "crm_x":\n    return client.request("/api/v1/deals/1/attachments");'
    );
    expect(a.get("crm_x")).not.toBe(b.get("crm_x"));
  });
});
