/**
 * better-auth `user.additionalFields`. Kept in its own module so the test can
 * run better-auth's real input parser against exactly this config.
 *
 * `input: false` on both: they gate every CRM request (api-utils.ts,
 * require-app-admin.ts), so only server code may write them (the sign-up
 * hook in auth.ts, the admin approve/reject routes, employee-accounts.ts).
 * Without it, /api/auth/update-user lets a signed-in user set them.
 */
export const userAdditionalFields = {
  approvalStatus: {
    type: "string",
    required: false,
    defaultValue: "pending",
    input: false,
  },
  isAppAdmin: {
    type: "boolean",
    required: false,
    defaultValue: false,
    input: false,
  },
} as const;
