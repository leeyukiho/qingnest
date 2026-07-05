import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const env = loadEnv(mode, repoRoot, "");

  return {
    root: path.resolve(repoRoot, "apps/web"),
    plugins: [react()],
    resolve: {
      alias: {
        "@qingnest/shared": path.resolve(repoRoot, "packages/shared/src")
      }
    },
    server: {
      port: Number(env.VITE_DEV_PORT ?? 5173),
      proxy: {
        "/api": {
          target: env.VITE_WORKER_DEV_URL ?? "http://127.0.0.1:8787",
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: path.resolve(repoRoot, "dist"),
      emptyOutDir: true,
      sourcemap: true
    }
  };
});
