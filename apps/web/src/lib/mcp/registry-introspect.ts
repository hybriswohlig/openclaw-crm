/**
 * Pure source-text scanners used by the MCP drift guard.
 *
 * The stdio registry (`apps/mcp`) is a separate package with its own
 * tsconfig, so the guard reads it as text instead of importing it — an
 * import would pull that package into the web app's type-check graph. These
 * helpers take source strings and return data, so they are unit-testable on
 * fixtures and never touch the filesystem themselves.
 *
 * Limitation, deliberately accepted: the scanner understands strings,
 * template literals and comments, but not regex literals. None of the four
 * registry files contains one; if that ever changes, this needs a real
 * tokenizer rather than a patch.
 */

/**
 * Blank out `//` and block comments, leaving string contents untouched.
 *
 * Comments are replaced with spaces rather than removed so every offset —
 * and therefore every line number in a failure message — stays intact. The
 * quote tracking is what stops a URL inside a string ("http://…") from being
 * read as the start of a comment.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (quote) {
      if (c === "\\") {
        out += c + (next ?? "");
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      i++;
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
      continue;
    }

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }

    if (c === "/" && next === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

/**
 * Every `case "crm_…":` label in a dispatch switch.
 *
 * Anchored to the start of a line so a tool name quoted inside prose cannot
 * masquerade as an implemented branch.
 */
export function switchCases(source: string): string[] {
  return [
    ...stripComments(source).matchAll(/^\s*case "(crm_[a-z0-9_]+)":/gm),
  ].map((m) => m[1]);
}

/** Every `name: "crm_…",` key in the JSON-Schema registry. */
export function definitionNames(source: string): string[] {
  return [
    ...stripComments(source).matchAll(/^\s*name: "(crm_[a-z0-9_]+)",$/gm),
  ].map((m) => m[1]);
}

/**
 * Tool name → description, read out of the stdio ToolDef source.
 *
 * Relies on the house convention that `description` is the key immediately
 * after `name` in every ToolDef, and that it is one plain double-quoted
 * literal (never a template literal and never two literals joined with `+`).
 * `\s*` spans newlines, so the common wrapped form is handled.
 */
export function definitionDescriptions(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /name: "(crm_[a-z0-9_]+)",\s*description:\s*("(?:[^"\\]|\\.)*")/g;
  for (const m of stripComments(source).matchAll(re)) {
    out.set(m[1], JSON.parse(m[2]) as string);
  }
  return out;
}

/** Collapse `${…}` interpolations so two spellings of the same route match. */
function normalisePath(path: string): string {
  return path.replace(/\$\{[^}]*\}/g, "{}");
}

/**
 * Tool name → the first `/api/…` literal inside its dispatch case.
 *
 * A case with no such literal (a purely local result, or a path built from
 * arguments) is simply absent from the map; the caller decides whether that
 * is allowed via TOOLS_WITHOUT_FIXED_PATH.
 */
export function casePaths(source: string): Map<string, string> {
  const code = stripComments(source);
  const marks: Array<{ name: string; start: number }> = [];
  for (const m of code.matchAll(/^\s*case "(crm_[a-z0-9_]+)":/gm)) {
    marks.push({ name: m[1], start: (m.index ?? 0) + m[0].length });
  }

  const out = new Map<string, string>();
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : code.length;
    const body = code.slice(marks[i].start, end);
    const hit = body.match(/["`](\/api\/[^"`]*)["`]/);
    if (hit) out.set(marks[i].name, normalisePath(hit[1]));
  }
  return out;
}
