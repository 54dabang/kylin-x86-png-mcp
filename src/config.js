import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultPort = Number.parseInt(process.env.PORT || "7003", 10);

export const config = {
  rootDir,
  chartsDir: path.resolve(process.env.CHARTS_DIR || path.join(rootDir, "charts")),
  host: process.env.HOST || "0.0.0.0",
  publicBaseUrl: normalizeBaseUrl(process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${defaultPort}`),
  defaultPort,
  rsvgConvertBin: process.env.RSVG_CONVERT_BIN || "rsvg-convert",
  renderZoom: Number.parseFloat(process.env.RENDER_ZOOM || "2"),
  imageTtlMs: parsePositiveNumber(process.env.IMAGE_TTL_HOURS, 24) * 60 * 60 * 1000,
  cleanupIntervalMs: parsePositiveNumber(process.env.CLEANUP_INTERVAL_MINUTES, 60) * 60 * 1000,
  fontFamily:
    process.env.ECHARTS_FONT_FAMILY ||
    "Noto Sans CJK SC, Noto Sans CJK, WenQuanYi Micro Hei, Microsoft YaHei, PingFang SC, Arial, sans-serif",
};

export function configureRuntime({ port } = {}) {
  if (!process.env.PUBLIC_BASE_URL && Number.isFinite(port)) {
    config.publicBaseUrl = normalizeBaseUrl(`http://127.0.0.1:${port}`);
  }
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number.parseFloat(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
