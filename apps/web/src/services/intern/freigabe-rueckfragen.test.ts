import { beforeEach, describe, expect, it, vi } from "vitest";

// Rückkanal: eine Nachricht einer internen Nummer, die kein Freigabe-Befehl ist,
// geht an beantworteRueckfrage; nur deren Bestätigung geht zurück, an den Absender.
const mocks = vi.hoisted(() => ({ beantworteRueckfrage: vi.fn(), sendeAnInterne: vi.fn() }));

vi.mock("./rueckfragen", () => ({ beantworteRueckfrage: mocks.beantworteRueckfrage }));
vi.mock("./intern-senden", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./intern-senden")>();
  return { ...actual, sendeAnInterne: mocks.sendeAnInterne };
});

import { verarbeiteInterneNachricht } from "./freigabe";

const absender = { name: "Dario", ziffern: "4917600000000", lids: [] };

describe("verarbeiteInterneNachricht: Rückfragen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Antwort auf eine Rückfrage wird gespeichert und kurz bestätigt, nur an den Absender", async () => {
    mocks.beantworteRueckfrage.mockResolvedValue("Danke, #R7K2 notiert.");
    await verarbeiteInterneNachricht({ workspaceId: "ws1", kontoId: "k1", absender, text: "R7K2 privat" });
    expect(mocks.beantworteRueckfrage).toHaveBeenCalledWith("ws1", "Dario", "R7K2 privat");
    expect(mocks.sendeAnInterne).toHaveBeenCalledWith("ws1", "Danke, #R7K2 notiert.", { kontoId: "k1", nurAn: ["Dario"] });
  });

  it("Text ohne offene Rückfrage wird wie bisher verworfen", async () => {
    mocks.beantworteRueckfrage.mockResolvedValue(null);
    await verarbeiteInterneNachricht({ workspaceId: "ws1", kontoId: "k1", absender, text: "Bin gleich da" });
    expect(mocks.beantworteRueckfrage).toHaveBeenCalledTimes(1);
    expect(mocks.sendeAnInterne).not.toHaveBeenCalled();
  });
});
