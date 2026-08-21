import path from "path";
import fs from "fs";
import express from "express";
import env from "../config/env.js";

/**
 * Mount React production build (same-origin /api).
 * Looks under ADSecurity_HOME/app/frontend, then sibling icm-frontend/dist.
 */
export function resolveFrontendDistDir() {
  const candidates = [
    path.join(env.paths?.home || "", "app", "frontend"),
    path.resolve(env.paths?.packageRoot || "", "../icm-frontend/dist"),
    path.resolve(env.paths?.packageRoot || "", "frontend"),
  ];
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, "index.html"))) {
      return dir;
    }
  }
  return null;
}

/**
 * @param {import('express').Express} app
 */
export function mountSpaStatic(app) {
  if (env.isDev && process.env.SERVE_SPA !== "true") {
    return null;
  }

  const distDir = resolveFrontendDistDir();
  if (!distDir) {
    console.warn("[spa] Frontend dist not found — API-only mode");
    return null;
  }

  console.log(`[spa] Serving frontend from ${distDir}`);
  app.use(express.static(distDir, { index: false, maxAge: "1h" }));

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
      return next();
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }
    res.sendFile(path.join(distDir, "index.html"), (err) => {
      if (err) next(err);
    });
  });

  return distDir;
}
