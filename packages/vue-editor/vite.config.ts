import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    alias: {
      "@iriograph/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: "iriograph-vue-editor",
      cssFileName: "iriograph-vue-editor",
    },
    rollupOptions: {
      external: ["vue", "@iriograph/core"],
    },
  },
});
