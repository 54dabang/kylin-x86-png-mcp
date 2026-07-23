import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";

const chartFilePattern = /^[a-zA-Z0-9_-]+\.(png|svg)$/;
let cleanupTimer;

export function chartPathFor(filename) {
  return `/charts/${encodeURIComponent(filename)}`;
}

export function chartUrlFor(filename) {
  return `${config.publicBaseUrl}${chartPathFor(filename)}`;
}

export function ttlSeconds() {
  return Math.floor(config.imageTtlMs / 1000);
}

export function expiresAtFor(createdAtMs) {
  return new Date(createdAtMs + config.imageTtlMs).toISOString();
}

export async function getChartFileInfo(filename) {
  if (!isSafeChartFilename(filename)) {
    return { status: "invalid" };
  }

  const filePath = path.join(config.chartsDir, filename);

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { status: "missing" };

    const expiresAtMs = stat.mtimeMs + config.imageTtlMs;
    if (expiresAtMs <= Date.now()) {
      await deleteFileQuietly(filePath);
      return { status: "expired" };
    }

    return {
      status: "available",
      filePath,
      filename,
      stat,
      expiresAt: new Date(expiresAtMs).toUTCString(),
      maxAge: Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000)),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing" };
    throw error;
  }
}

export async function cleanupExpiredCharts() {
  await fs.mkdir(config.chartsDir, { recursive: true });
  const entries = await fs.readdir(config.chartsDir);
  const now = Date.now();
  let removed = 0;

  for (const filename of entries) {
    if (!isSafeChartFilename(filename)) continue;
    const filePath = path.join(config.chartsDir, filename);

    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile() && stat.mtimeMs + config.imageTtlMs <= now) {
        await fs.unlink(filePath);
        removed += 1;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return removed;
}

export function startChartCleanupTimer() {
  if (cleanupTimer) return cleanupTimer;

  cleanupExpiredCharts().catch((error) => {
    console.error("Initial chart cleanup failed:", error);
  });

  cleanupTimer = setInterval(() => {
    cleanupExpiredCharts().catch((error) => {
      console.error("Chart cleanup failed:", error);
    });
  }, config.cleanupIntervalMs);

  cleanupTimer.unref?.();
  return cleanupTimer;
}

function isSafeChartFilename(filename) {
  return path.basename(filename) === filename && chartFilePattern.test(filename);
}

async function deleteFileQuietly(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
