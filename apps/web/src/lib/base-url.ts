export const baseUrl = (
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://localhost:3000"
).trim().replace(/\/+$/, "");
