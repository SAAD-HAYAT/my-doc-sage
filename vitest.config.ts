import path from "node:path";
import { defineConfig } from "vitest/config";

// Needed so tests can import route/lib modules the same way the app does
// ("@/lib/..."), and so vi.mock("@/lib/...") resolves to the same module
// the code under test imports — without this, aliased imports in
// tests/chat.test.ts (which imports the real app/api/chat/route.ts) fail
// to resolve.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd()),
    },
  },
  test: {
    environment: "node",
  },
});
