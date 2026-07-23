import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import * as echarts from "echarts";
import { config } from "../config.js";
import { chartPathFor, chartUrlFor, expiresAtFor, ttlSeconds } from "./chart-storage.js";
import { withOfflineDefaults } from "./option.js";

const execFileAsync = promisify(execFile);

export async function renderChart(option, width = 800, height = 600, theme = "default", outputType = "png", toolName = "chart") {
  const safeWidth = clampInt(width, 50, 5000);
  const safeHeight = clampInt(height, 50, 5000);
  const echartsOption = withOfflineDefaults(option);

  if (outputType === "option") {
    return {
      type: "option",
      text: JSON.stringify(echartsOption, null, 2),
      width: safeWidth,
      height: safeHeight,
    };
  }

  const svg = renderSvg(echartsOption, safeWidth, safeHeight, theme);
  if (outputType === "svg") {
    return {
      type: "svg",
      text: svg,
      width: safeWidth,
      height: safeHeight,
    };
  }

  await fs.mkdir(config.chartsDir, { recursive: true });
  const createdAtMs = Date.now();
  const id = `${sanitizeName(toolName)}_${createdAtMs}_${crypto.randomBytes(5).toString("hex")}`;
  const svgFile = path.join(config.chartsDir, `${id}.svg`);
  const pngFile = path.join(config.chartsDir, `${id}.png`);
  const pngName = path.basename(pngFile);

  await fs.writeFile(svgFile, svg, "utf8");
  await execFileAsync(config.rsvgConvertBin, [
    "--zoom",
    String(config.renderZoom),
    "-f",
    "png",
    "-o",
    pngFile,
    svgFile,
  ]);

  const stat = await fs.stat(pngFile);

  return {
    type: "png",
    chartUrl: chartUrlFor(pngName),
    chartPath: chartPathFor(pngName),
    imageFile: pngFile,
    svgFile,
    imageFormat: "png",
    expiresAt: expiresAtFor(createdAtMs),
    ttlSeconds: ttlSeconds(),
    size: {
      width: safeWidth,
      height: safeHeight,
      bytes: stat.size,
      zoom: config.renderZoom,
    },
  };
}

export function toMcpTextResponse(result) {
  if (result.type === "svg" || result.type === "option") {
    return {
      content: [
        {
          type: "text",
          text: result.text,
        },
      ],
    };
  }

  const payload = {
    status: "success",
    chartUrl: result.chartUrl,
    chartPath: result.chartPath,
    imageFile: result.imageFile,
    imageFormat: result.imageFormat,
    expiresAt: result.expiresAt,
    ttlSeconds: result.ttlSeconds,
    size: result.size,
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export async function generateChartImage(option, width, height, theme, outputType, toolName) {
  try {
    const result = await renderChart(option, width, height, theme, outputType, toolName);
    return toMcpTextResponse(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Chart rendering failed: ${detail}`);
  }
}

function renderSvg(option, width, height, theme) {
  const chart = echarts.init(null, theme, {
    renderer: "svg",
    ssr: true,
    width,
    height,
  });

  chart.setOption(option);
  const svg = chart.renderToSVGString();
  chart.dispose();
  return svg;
}

function clampInt(value, min, max) {
  const num = Number.isFinite(value) ? Math.trunc(value) : min;
  return Math.min(Math.max(num, min), max);
}

function sanitizeName(value) {
  return String(value || "chart").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "chart";
}
