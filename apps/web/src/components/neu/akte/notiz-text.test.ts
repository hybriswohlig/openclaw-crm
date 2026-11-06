import { describe, expect, it } from "vitest";
import { notizDokument, notizText } from "./notiz-text";

describe("notizText", () => {
  it("lässt einen String, wie er ist, und gibt für anderes Leeres nichts", () => {
    expect(notizText("Hallo")).toBe("Hallo");
    expect(notizText(null)).toBe("");
    expect(notizText(42)).toBe("");
    expect(notizText({ type: "doc" })).toBe("");
  });

  it("trennt Absätze mit Zeilenumbruch und hängt Inline-Knoten aneinander", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Erste " }, { type: "text", text: "Zeile", marks: [{ type: "bold" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Zweite" }, { type: "hardBreak" }, { type: "text", text: "Dritte" }] },
      ],
    };
    expect(notizText(doc)).toBe("Erste Zeile\nZweite\nDritte");
  });

  it("schreibt Listenpunkte je Zeile", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Kartons" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Wandschrank" }] }] },
          ],
        },
      ],
    };
    expect(notizText(doc)).toBe("Kartons\nWandschrank");
  });
});

describe("notizDokument", () => {
  it("macht aus jeder Zeile einen Absatz, leere Zeilen ohne Inhalt", () => {
    expect(notizDokument("a\n\nb")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "b" }] },
      ],
    });
  });

  it("kommt über notizText unverändert zurück", () => {
    expect(notizText(notizDokument("Kunde ruft Montag an.\nDemontage einplanen."))).toBe(
      "Kunde ruft Montag an.\nDemontage einplanen."
    );
  });
});
