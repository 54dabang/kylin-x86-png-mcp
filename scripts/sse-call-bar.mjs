const baseUrl = process.argv[2] || "http://127.0.0.1:7003";
const sseUrl = `${baseUrl.replace(/\/$/, "")}/sse`;

const sse = await fetch(sseUrl, {
  headers: { Accept: "text/event-stream" },
});

if (!sse.ok || !sse.body) {
  throw new Error(`SSE connection failed: ${sse.status} ${sse.statusText}`);
}

const reader = sse.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let endpoint;

while (!endpoint) {
  const { value, done } = await reader.read();
  if (done) throw new Error("SSE stream ended before endpoint event.");
  buffer += decoder.decode(value, { stream: true });
  const events = buffer.split("\n\n");
  buffer = events.pop() || "";

  for (const event of events) {
    const dataLine = event.split("\n").find((line) => line.startsWith("data: "));
    if (event.includes("event: endpoint") && dataLine) {
      endpoint = dataLine.slice("data: ".length).trim();
      break;
    }
  }
}

const sessionUrl = new URL(endpoint, baseUrl);
const rpc = async (body) => {
  const response = await fetch(sessionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`RPC failed: ${response.status} ${await response.text()}`);
  }
};

await rpc({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke-sse-client", version: "0.1.0" },
  },
});

await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });

await rpc({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: {
    name: "generate_bar_chart",
    arguments: {
      data: "[{\"category\": \"类兴邦\", \"value\": 9.70}, {\"category\": \"肖棋元\", \"value\": 8.52}, {\"category\": \"刘晶晶\", \"value\": 7.37}, {\"category\": \"庄宇飞\", \"value\": 6.97}, {\"category\": \"张兆乾\", \"value\": 6.41}, {\"category\": \"彭子瑞\", \"value\": 5.01}]",
      title: "报销金额排名前六名人员",
      axisXTitle: "人员姓名",
      axisYTitle: "报销金额(万元)",
    },
  },
});

let resultText = "";
while (!resultText) {
  const { value, done } = await reader.read();
  if (done) throw new Error("SSE stream ended before tool result.");
  buffer += decoder.decode(value, { stream: true });
  const events = buffer.split("\n\n");
  buffer = events.pop() || "";

  for (const event of events) {
    const dataLine = event.split("\n").find((line) => line.startsWith("data: "));
    if (!dataLine) continue;
    const payload = JSON.parse(dataLine.slice("data: ".length));
    if (payload.id === 2) {
      resultText = payload.result.content[0].text;
      break;
    }
  }
}

await reader.cancel();
console.log(resultText);
