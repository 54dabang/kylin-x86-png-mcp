#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config, configureRuntime } from "./config.js";
import { toolMap, tools } from "./tools/index.js";
import { getChartFileInfo, startChartCleanupTimer } from "./utils/index.js";

function createServer() {
  const server = new McpServer({
    name: "kylin-x86-png-mcp",
    version: "0.1.0",
  });

  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.inputSchema.shape, tool.run);
  }

  return server;
}

const { values } = parseArgs({
  options: {
    transport: { type: "string", short: "t", default: "sse" },
    port: { type: "string", short: "p", default: String(config.defaultPort) },
    endpoint: { type: "string", short: "e", default: "" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`
Kylin x86 PNG MCP

Options:
  --transport, -t  "stdio", "sse", or "streamable" (default: sse)
  --port, -p       HTTP port for SSE/streamable transport (default: 7003)
  --endpoint, -e   SSE endpoint (default: /sse) or streamable endpoint (default: /mcp)
`);
  process.exit(0);
}

const transport = values.transport.toLowerCase();
const port = Number.parseInt(values.port, 10);
configureRuntime({ port });
startChartCleanupTimer();

if (transport === "stdio") {
  await runStdioServer();
} else if (transport === "streamable") {
  await runStreamableHTTPServer(port, values.endpoint || "/mcp");
} else {
  await runSSEServer(port, values.endpoint || "/sse");
}

async function runStdioServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runSSEServer(port, endpoint) {
  const app = createApp();
  const transports = {};

  app.get(endpoint, async (_req, res) => {
    const server = createServer();
    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = transport;
    res.on("close", () => {
      delete transports[transport.sessionId];
    });
    await server.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = transports[sessionId];
    if (!transport) {
      res.status(400).send("No transport found for sessionId");
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });

  app.listen(port, config.host, () => {
    console.log(`Kylin x86 PNG MCP SSE server listening on http://127.0.0.1:${port}${endpoint}`);
  });
}

async function runStreamableHTTPServer(port, endpoint) {
  const app = createApp();
  const transports = {};

  app.post(endpoint, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    let transport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports[newSessionId] = transport;
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) delete transports[transport.sessionId];
      };
      await createServer().connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: no valid session ID provided" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  app.get(endpoint, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.delete(endpoint, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.listen(port, config.host, () => {
    console.log(`Kylin x86 PNG MCP streamable server listening on http://127.0.0.1:${port}${endpoint}`);
  });
}

function createApp() {
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  app.get("/charts/:filename", serveChartFile);
  app.post("/api/render", (req, res) => handleToolRequest(req, res, "generate_echarts", { sendPng: true }));
  app.post("/api/render/:toolName", (req, res) => handleToolRequest(req, res, req.params.toolName, { sendPng: true }));
  app.post("/api/tools/:toolName", (req, res) => handleToolRequest(req, res, req.params.toolName));
  app.get("/health", (_req, res) => {
    res.json({
      status: "healthy",
      service: "kylin-x86-png-mcp",
      transport: "sse",
      chartsDir: config.chartsDir,
      renderer: "echarts-svg-ssr+rsvg-convert",
      canvas: false,
      imageTtlHours: config.imageTtlMs / 60 / 60 / 1000,
      publicBaseUrl: config.publicBaseUrl,
      httpToolEndpoint: "/api/tools/:toolName",
      directPngEndpoint: "/api/render/:toolName",
      chartEndpoint: "/charts/:filename",
    });
  });
  return app;
}

async function serveChartFile(req, res) {
  try {
    const info = await getChartFileInfo(req.params.filename);

    if (info.status === "invalid") {
      res.status(400).json({ status: "error", message: "Invalid chart filename." });
      return;
    }

    if (info.status === "missing") {
      res.status(404).json({ status: "error", message: "Chart image was not found." });
      return;
    }

    if (info.status === "expired") {
      res.status(410).json({ status: "error", message: `Chart image expired after ${config.imageTtlMs / 60 / 60 / 1000} hours.` });
      return;
    }

    setImageCacheHeaders(res, info);
    res.sendFile(info.filePath);
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleToolRequest(req, res, toolName, { sendPng = false } = {}) {
  const tool = toolMap.get(toolName);
  if (!tool) {
    res.status(404).json({
      status: "error",
      message: `Unknown tool: ${toolName}`,
      availableTools: tools.map((item) => item.name),
    });
    return;
  }

  try {
    const body = sendPng ? { ...(req.body ?? {}), outputType: "png" } : (req.body ?? {});
    const parsed = tool.inputSchema.parse(body);
    const result = await tool.run(parsed);
    const payload = payloadFromToolResult(result, tool.name);
    const responsePayload = withRequestChartUrl(req, payload);

    if (!sendPng) {
      res.json(responsePayload);
      return;
    }

    if (responsePayload.imageFormat !== "png" || !responsePayload.imageFile) {
      res.status(500).json({
        status: "error",
        message: "Tool did not return a PNG image.",
      });
      return;
    }

    const filename = path.basename(responsePayload.imageFile);
    const info = await getChartFileInfo(filename);
    if (info.status !== "available") {
      res.status(500).json({
        status: "error",
        message: "Rendered PNG image is not available.",
      });
      return;
    }

    setImageCacheHeaders(res, {
      ...info,
      maxAge: Number.isFinite(responsePayload.ttlSeconds) ? responsePayload.ttlSeconds : info.maxAge,
      expiresAt: responsePayload.expiresAt ? new Date(responsePayload.expiresAt).toUTCString() : info.expiresAt,
    });
    res.set("X-Chart-Url", responsePayload.chartUrl);
    res.set("X-Chart-Path", responsePayload.chartPath || "");
    res.set("X-Chart-Expires-At", responsePayload.expiresAt || "");
    res.type("png");
    res.sendFile(info.filePath);
  } catch (error) {
    res.status(400).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function payloadFromToolResult(result, toolName) {
  const text = result?.content?.[0]?.text;
  if (!text) {
    throw new Error("Tool returned an empty response.");
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      status: "success",
      tool: toolName,
      result: text,
    };
  }
}

function withRequestChartUrl(req, payload) {
  if (!payload?.chartPath) return payload;
  return {
    ...payload,
    chartUrl: `${requestBaseUrl(req)}${payload.chartPath}`,
  };
}

function requestBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return config.publicBaseUrl;

  const proto = firstHeaderValue(req.get("x-forwarded-proto")) || req.protocol || "http";
  const host = firstHeaderValue(req.get("x-forwarded-host")) || req.get("host") || `127.0.0.1:${config.defaultPort}`;
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function firstHeaderValue(value) {
  return value?.split(",")[0]?.trim();
}

function setImageCacheHeaders(res, info) {
  res.set("Cache-Control", `public, max-age=${info.maxAge}, must-revalidate`);
  res.set("Expires", info.expiresAt);
}

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  process.exit(1);
});
