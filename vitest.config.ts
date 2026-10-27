import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packages = fileURLToPath(new URL("./packages/", import.meta.url));

/** Test against package sources so every importer shares one module id (needed for mocks). */
export const workspaceAlias = [
  { find: /^@chambelli\/([a-z-]+)$/, replacement: `${packages}$1/src/index.ts` },
];

export default defineConfig({
  resolve: { alias: workspaceAlias },
  test: {
    include: ["tests/**/*.test.ts", "packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "tests/integration/**"],
    environment: "node",
  },
});
