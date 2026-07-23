const baseUrl = process.argv[2] || "http://127.0.0.1:7003";
const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
const sseUrl = `${normalizedBaseUrl}/sse`;

const sourceData = [
  { category: "类兴邦", value: 9.7 },
  { category: "肖棋元", value: 8.52 },
  { category: "刘晶晶", value: 7.37 },
  { category: "庄宇飞", value: 6.97 },
  { category: "张兆乾", value: 6.41 },
  { category: "彭子瑞", value: 5.01 },
];

const calls = [
  {
    name: "generate_bar_chart",
    arguments: {
      data: JSON.stringify(sourceData),
      title: "报销金额排名前六名人员 - 柱状图",
      axisXTitle: "人员姓名",
      axisYTitle: "报销金额(万元)",
    },
  },
  {
    name: "generate_pie_chart",
    arguments: {
      data: JSON.stringify(sourceData),
      title: "报销金额排名前六名人员 - 饼图",
      innerRadius: 0.45,
    },
  },
  {
    name: "generate_line_chart",
    arguments: {
      data: JSON.stringify(sourceData.map((item) => ({ time: item.category, value: item.value }))),
      title: "报销金额排名前六名人员 - 折线图",
      axisXTitle: "人员姓名",
      axisYTitle: "报销金额(万元)",
      showSymbol: true,
      smooth: true,
    },
  },
  {
    name: "generate_area_chart",
    arguments: {
      data: JSON.stringify(sourceData.map((item) => ({ time: item.category, value: item.value }))),
      title: "报销金额排名前六名人员 - 面积图",
      axisXTitle: "人员姓名",
      axisYTitle: "报销金额(万元)",
      smooth: true,
    },
  },
  {
    name: "generate_radar_chart",
    arguments: {
      data: JSON.stringify(sourceData.map((item) => ({ name: item.category, value: item.value }))),
      title: "报销金额排名前六名人员 - 雷达图",
    },
  },
  {
    name: "generate_funnel_chart",
    arguments: {
      data: JSON.stringify(sourceData),
      title: "报销金额排名前六名人员 - 漏斗图",
    },
  },
  {
    name: "generate_scatter_chart",
    arguments: {
      data: JSON.stringify(sourceData.map((item, index) => ({ x: index + 1, y: item.value }))),
      title: "报销金额排名前六名人员 - 散点图",
      axisXTitle: "排名",
      axisYTitle: "报销金额(万元)",
    },
  },
  {
    name: "generate_echarts",
    arguments: {
      echartsOption: JSON.stringify({
        title: { text: "报销金额排名前六名人员 - 横向条形图", left: "center" },
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        grid: { left: 96, right: 40, top: 82, bottom: 44, containLabel: true },
        xAxis: { type: "value", name: "报销金额(万元)", nameGap: 36, nameLocation: "middle" },
        yAxis: {
          type: "category",
          data: sourceData.map((item) => item.category).reverse(),
          axisLabel: { interval: 0 },
        },
        series: [
          {
            type: "bar",
            data: sourceData.map((item) => item.value).reverse(),
            barMaxWidth: 42,
            itemStyle: { borderRadius: [0, 4, 4, 0] },
            label: { show: true, position: "right" },
          },
        ],
      }),
      width: 800,
      height: 600,
    },
  },
];

const sse = await fetch(sseUrl, { headers: { Accept: "text/event-stream" } });
if (!sse.ok || !sse.body) throw new Error(`SSE connection failed: ${sse.status} ${sse.statusText}`);

const reader = sse.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

const endpoint = await waitForEndpoint();
const sessionUrl = new URL(endpoint, normalizedBaseUrl);

await rpc({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "multi-chart-smoke-client", version: "0.1.0" },
  },
});
await waitForResponse(1);
await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });

const results = [];
let id = 2;
for (const call of calls) {
  await rpc({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: call,
  });
  const response = await waitForResponse(id);
  const text = response.result.content[0].text;
  results.push({ tool: call.name, ...JSON.parse(text) });
  id += 1;
}

await reader.cancel();
console.log(JSON.stringify(results, null, 2));

async function rpc(body) {
  const response = await fetch(sessionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`RPC failed: ${response.status} ${await response.text()}`);
  }
}

async function waitForEndpoint() {
  while (true) {
    for (const event of await readEvents()) {
      const dataLine = event.split("\n").find((line) => line.startsWith("data: "));
      if (event.includes("event: endpoint") && dataLine) return dataLine.slice("data: ".length).trim();
    }
  }
}

async function waitForResponse(id) {
  while (true) {
    for (const event of await readEvents()) {
      const dataLine = event.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const payload = JSON.parse(dataLine.slice("data: ".length));
      if (payload.id === id) return payload;
    }
  }
}

async function readEvents() {
  const { value, done } = await reader.read();
  if (done) throw new Error("SSE stream ended.");
  buffer += decoder.decode(value, { stream: true });
  const events = buffer.split("\n\n");
  buffer = events.pop() || "";
  return events.filter(Boolean);
}
