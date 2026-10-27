import { defineConfig } from "vitest/config";
import { workspaceAlias } from "./vitest.config";

/** Integration tests need a real PostgreSQL database (DATABASE_URL). CI provides one. */
export default defineConfig({
  resolve: { alias: workspaceAlias },
  test: {
    include: ["tests/integration/**/*.int.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
