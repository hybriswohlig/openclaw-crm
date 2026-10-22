import { describe, expect, it } from "vitest";
import { parseUserInput } from "better-auth/db";
import { userAdditionalFields } from "./auth-user-fields";

// approvalStatus/isAppAdmin gate every CRM request (api-utils.ts,
// require-app-admin.ts). better-auth's /update-user and /sign-up parse the
// request body with parseUserInput, so these tests run the real parser
// against our field config: a signed-in user must not be able to approve
// or promote themselves.
const options = {
  user: { additionalFields: userAdditionalFields },
} as unknown as Parameters<typeof parseUserInput>[0];

describe("userAdditionalFields", () => {
  it("rejects approvalStatus on update", () => {
    expect(() => parseUserInput(options, { approvalStatus: "approved" }, "update")).toThrow(
      /not allowed/
    );
  });

  it("rejects isAppAdmin on update", () => {
    expect(() => parseUserInput(options, { isAppAdmin: true }, "update")).toThrow(/not allowed/);
  });

  it("ignores client values on sign-up and uses the defaults", () => {
    expect(
      parseUserInput(options, { approvalStatus: "approved", isAppAdmin: true }, "create")
    ).toMatchObject({ approvalStatus: "pending", isAppAdmin: false });
  });
});
