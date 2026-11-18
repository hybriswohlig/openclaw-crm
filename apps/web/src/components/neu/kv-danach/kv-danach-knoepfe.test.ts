import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KvDanachKnoepfe } from "./kv-danach-knoepfe";

(globalThis as { React?: typeof React }).React = React;

describe("KvDanachKnoepfe", () => {
  it("verlinkt „Im Chat senden“ auf den Auftrag der Art", () => {
    const angepasst = renderToStaticMarkup(
      createElement(KvDanachKnoepfe, { dealId: "deal_1", klasse: "x", art: "angepasst", neuAnnehmen: true })
    );
    expect(angepasst).toContain("kv=angepasst&amp;annahme=1");

    const fertig = renderToStaticMarkup(createElement(KvDanachKnoepfe, { dealId: "deal_1", klasse: "x" }));
    expect(fertig).toContain("kv=1");
    expect(fertig).not.toContain("angepasst");
    expect(fertig).not.toContain("annahme");
  });
});
