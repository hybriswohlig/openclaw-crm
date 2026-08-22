import { describe, expect, it } from "vitest";
import { toProjectMemberData, resolveOwnerMembership } from "./project-members";

describe("toProjectMemberData", () => {
  it("maps a joined user row into the avatar-stack shape", () => {
    expect(
      toProjectMemberData({
        userId: "u1",
        role: "leiter",
        name: "Dario Kottke",
        email: "dario@kottke-umzuege.de",
        image: "https://cdn.example/dario.png",
      }),
    ).toEqual({
      userId: "u1",
      role: "leiter",
      name: "Dario Kottke",
      email: "dario@kottke-umzuege.de",
      image: "https://cdn.example/dario.png",
    });
  });

  it("falls back to 'mitglied' for an unknown or missing role", () => {
    expect(toProjectMemberData({ userId: "u2", role: "chef", name: "Nuri", email: "n@x.de", image: null }).role).toBe("mitglied");
    expect(toProjectMemberData({ userId: "u3", role: null, name: "Nuri", email: "n@x.de", image: null }).role).toBe("mitglied");
  });

  it("uses the email when the user has no name, and 'Unbekannt' as the last resort", () => {
    expect(toProjectMemberData({ userId: "u4", role: "mitglied", name: "   ", email: "n@x.de", image: null }).name).toBe("n@x.de");
    expect(toProjectMemberData({ userId: "u5", role: "mitglied", name: null, email: null, image: null }).name).toBe("Unbekannt");
  });

  it("never returns undefined for email or image", () => {
    const m = toProjectMemberData({ userId: "u6", role: "beobachter", name: "X", email: null, image: null });
    expect(m.email).toBe("");
    expect(m.image).toBeNull();
  });
});

describe("resolveOwnerMembership — exactly one 'leiter' survives", () => {
  it("demotes the previous owner who still has work in the project", () => {
    const plan = resolveOwnerMembership(
      [
        { userId: "dario", role: "leiter", hasProjectWork: true },
        { userId: "nuri", role: "mitglied", hasProjectWork: true },
      ],
      "dario",
      "nuri",
    );
    expect(plan).toEqual({ demoteToMitglied: ["dario"], remove: [], upsertLeiter: "nuri" });
  });

  it("removes the previous owner who was only there as owner", () => {
    const plan = resolveOwnerMembership(
      [{ userId: "dario", role: "leiter", hasProjectWork: false }],
      "dario",
      "nuri",
    );
    expect(plan).toEqual({ demoteToMitglied: [], remove: ["dario"], upsertLeiter: "nuri" });
  });

  it("leaves the owner alone when the owner did not change", () => {
    const plan = resolveOwnerMembership(
      [
        { userId: "dario", role: "leiter", hasProjectWork: true },
        { userId: "nuri", role: "mitglied", hasProjectWork: true },
      ],
      "dario",
      "dario",
    );
    expect(plan).toEqual({ demoteToMitglied: [], remove: [], upsertLeiter: "dario" });
  });

  it("cleans up a stray second 'leiter' by demoting it, never deleting it", () => {
    const plan = resolveOwnerMembership(
      [
        { userId: "dario", role: "leiter", hasProjectWork: false },
        { userId: "extern", role: "leiter", hasProjectWork: false },
      ],
      "dario",
      "nuri",
    );
    expect(plan.remove).toEqual(["dario"]);
    expect(plan.demoteToMitglied).toEqual(["extern"]);
    expect(plan.upsertLeiter).toBe("nuri");
  });

  it("clears the owner: every leiter is demoted, nobody is promoted", () => {
    const plan = resolveOwnerMembership(
      [{ userId: "dario", role: "leiter", hasProjectWork: true }],
      "dario",
      null,
    );
    expect(plan).toEqual({ demoteToMitglied: ["dario"], remove: [], upsertLeiter: null });
  });

  it("promotes a brand-new owner who is not on the team yet", () => {
    const plan = resolveOwnerMembership([], null, "nuri");
    expect(plan).toEqual({ demoteToMitglied: [], remove: [], upsertLeiter: "nuri" });
  });

  it("never demotes or removes the incoming owner", () => {
    const plan = resolveOwnerMembership(
      [{ userId: "nuri", role: "leiter", hasProjectWork: false }],
      "dario",
      "nuri",
    );
    expect(plan.demoteToMitglied).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.upsertLeiter).toBe("nuri");
  });
});
