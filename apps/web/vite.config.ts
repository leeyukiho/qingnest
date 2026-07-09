import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const webRoot = path.resolve(repoRoot, "apps/web");
  const env = {
    ...loadEnv(mode, repoRoot, ""),
    ...loadEnv(mode, webRoot, "")
  };

  return {
    root: webRoot,
    envDir: repoRoot,
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(repoRoot, "apps/web/src"),
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
