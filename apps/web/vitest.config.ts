import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Pin the suite's timezone to Europe/Berlin. The app is single-tenant
    // German and every `date` column it reads/writes is a Berlin calendar
    // day, so local-vs-UTC date tests (work-metrics.test.ts: parseDateColumn,
    // toIsoDay) need to run in that zone to mean anything. Without this, CI
    // (ubuntu-latest, which defaults to UTC) runs those tests in a timezone
    // where local time IS UTC time, so a UTC-based bug (e.g.
    // `new Date(isoString)` / `d.toISOString().slice(0,10)`) is
    // indistinguishable from the correct local-midnight implementation and
    // every assertion passes either way. This machine is already
    // Europe/Berlin, so pinning it changes nothing locally — it only stops
    // CI from silently running a different calendar than dev.
    env: { TZ: "Europe/Berlin" },
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "tests-e2e", ".next"],
    coverage: {
      provider: "v8",
      include: ["src/lib/reviews/**/*.ts"],
    },
  },
});
