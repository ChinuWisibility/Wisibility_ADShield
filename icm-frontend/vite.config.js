import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === "analyze" &&
      visualizer({
        filename: "dist/bundle-analysis.json",
        template: "raw-data",
        open: false,
        gzipSize: true,
        brotliSize: true,
      }),
  ].filter(Boolean),
  server: {
    port: 3002,
    proxy: {
      "/api": {
        target: "http://localhost:8083",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "esnext",
    minify: "esbuild",
    rollupOptions: {
      output: {
        entryFileNames: "assets/entry/[name]-[hash].js",
        chunkFileNames: "assets/chunks/[name]-[hash].js",
        assetFileNames: "assets/static/[name]-[hash][extname]",
        manualChunks(id) {
          if (id.includes("lottie-react") || id.includes("lottie-web")) {
            return "vendor-lottie";
          }

          if (
            /[\\/]src[\\/]pages[\\/]governance[\\/]accessCertification[\\/]AccessCertificationWizard\.jsx$/.test(
              id,
            )
          ) {
            return "ac-wizard";
          }
          if (
            /[\\/]src[\\/]pages[\\/]governance[\\/]accessCertification[\\/]AccessCertificationReview\.jsx$/.test(
              id,
            )
          ) {
            return "ac-review";
          }
          if (
            /[\\/]src[\\/]pages[\\/]governance[\\/]accessCertification[\\/]AccessCertificationDashboard\.jsx$/.test(
              id,
            )
          ) {
            return "ac-analytics";
          }
          if (
            /[\\/]src[\\/]pages[\\/]governance[\\/]accessCertification[\\/]ReminderSettings\.jsx$/.test(
              id,
            )
          ) {
            return "ac-settings";
          }
          if (
            /[\\/]src[\\/]pages[\\/]governance[\\/]accessCertification[\\/]AccessCertification\.jsx$/.test(
              id,
            )
          ) {
            return "page-access-certification";
          }

          return undefined;
        },
      },
    },
  },
}));
