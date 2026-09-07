import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const vitePath = require.resolve("vite", { paths: [path.dirname(require.resolve("vitest/package.json"))] });
const { createServer } = await import(vitePath);
const { default: tailwind } = await import("@tailwindcss/postcss");
const root = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(root, "../..");
const server = await createServer({
  configFile: false, root, define: { "process.env": "{}" }, publicDir: path.join(web, "public"),
  resolve: { alias: { "@": path.join(web, "src") } },
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [tailwind()] } },
  server: { host: "127.0.0.1", port: 4178, strictPort: true, fs: { allow: [path.resolve(web, "../..")] } },
});
await server.listen();
console.log("Isolated portal preview: http://127.0.0.1:4178");
