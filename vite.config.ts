import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  test: {
    exclude: [...configDefaults.exclude, "**/.tmp/**"],
  },
  server: {
    strictPort: true,
    host: "127.0.0.1",
  },
});
