import { z } from "zod";
import { generateChartImage } from "../utils/index.js";
import {
  AxisXTitleSchema,
  AxisYTitleSchema,
  HeightSchema,
  OutputTypeSchema,
  ThemeSchema,
  TitleSchema,
  WidthSchema,
  createHierarchicalSchema,
} from "../utils/schema.js";

const chartBase = {
  height: HeightSchema,
  theme: ThemeSchema,
  title: TitleSchema,
  width: WidthSchema,
  outputType: OutputTypeSchema,
};

const stringifiedJson = z.string().transform((value, ctx) => {
  try {
    return JSON.parse(value);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expected valid JSON when passing data as a string.",
    });
    return z.NEVER;
  }
});

const flexibleArray = (schema, description, emptyMessage) =>
  z
    .union([z.array(schema), stringifiedJson.pipe(z.array(schema))])
    .describe(`${description} The value may be an array or a JSON string containing that array.`)
    .refine((value) => value.length > 0, { message: emptyMessage });

const flexibleObject = (schema, description) =>
  z.union([schema, stringifiedJson.pipe(schema)]).describe(`${description} The value may be an object or a JSON string containing that object.`);

const categoryValueSchema = z.object({
  category: z.string().describe("Category of the data point, such as 'Category A'."),
  value: z.number().describe("Value of the data point, such as 10."),
  group: z.string().optional().describe("Group name for multiple series."),
});

const timeValueSchema = z.object({
  group: z.string().optional().describe("Group name for multiple series."),
  time: z.string().describe("Time or category value."),
  value: z.number().describe("Numeric value."),
});

export const generateEChartsTool = {
  name: "generate_echarts",
  description:
    "Generate visual charts using Apache ECharts with an arbitrary ECharts option. This offline server renders PNG through ECharts SVG SSR and rsvg-convert.",
  inputSchema: z.object({
    echartsOption: z
      .union([z.string(), z.record(z.any())])
      .describe("A valid ECharts option as a JSON string or JSON object.")
      .refine((value) => (typeof value === "string" ? value.trim().length > 0 : true), {
        message: "A valid ECharts option cannot be empty.",
      }),
    width: z.number().min(50).max(5000).optional().default(800),
    height: z.number().min(50).max(5000).optional().default(600),
    theme: ThemeSchema,
    outputType: OutputTypeSchema,
  }),
  run: async ({ width, height, echartsOption, theme, outputType }) => {
    const option = typeof echartsOption === "string" ? JSON.parse(echartsOption) : echartsOption;
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      throw new Error("Invalid ECharts option, expected a JSON object.");
    }
    return generateChartImage(option, width, height, theme, outputType, "generate_echarts_chart");
  },
};

export const generateLineChartTool = {
  name: "generate_line_chart",
  description: "Generate a line chart to show trends over time.",
  inputSchema: z.object({
    axisXTitle: AxisXTitleSchema,
    axisYTitle: AxisYTitleSchema,
    data: flexibleArray(
      timeValueSchema,
      "Data for line chart, such as [{ time: '2015', value: 23 }, { time: '2016', value: 32 }].",
      "Line chart data cannot be empty.",
    ),
    showArea: z.boolean().optional().default(false),
    showSymbol: z.boolean().optional().default(true),
    smooth: z.boolean().optional().default(false),
    stack: z.boolean().optional().default(false),
    ...chartBase,
  }),
  run: (params) => runLineLike(params, "generate_line_chart"),
};

export const generateAreaChartTool = {
  ...generateLineChartTool,
  name: "generate_area_chart",
  description: "Generate an area chart to show trends and the magnitude under a line.",
  run: (params) => runLineLike({ ...params, showArea: true }, "generate_area_chart"),
};

export const generateBarChartTool = {
  name: "generate_bar_chart",
  description: "Generate a bar chart for numerical comparisons among categories.",
  inputSchema: z.object({
    axisXTitle: AxisXTitleSchema,
    axisYTitle: AxisYTitleSchema,
    data: flexibleArray(
      categoryValueSchema,
      "Data for bar chart, such as [{ category: 'Category A', value: 10 }].",
      "Bar chart data cannot be empty.",
    ),
    group: z.boolean().optional().default(false),
    stack: z.boolean().optional().default(false),
    ...chartBase,
  }),
  run: async ({ axisXTitle, axisYTitle, data, group = false, stack = false, height, theme, title, width, outputType }) => {
    const hasGroups = data.some((item) => item.group);
    let series = [];
    let categories = [];

    if (hasGroups && (group || stack)) {
      const groupMap = new Map();
      const categorySet = new Set();
      for (const item of data) {
        const groupName = item.group || "Default";
        if (!groupMap.has(groupName)) groupMap.set(groupName, []);
        groupMap.get(groupName).push({ category: item.category, value: item.value });
        categorySet.add(item.category);
      }
      categories = Array.from(categorySet).sort();
      series = Array.from(groupMap.entries()).map(([groupName, groupData]) => {
        const dataMap = new Map(groupData.map((item) => [item.category, item.value]));
        return {
          data: categories.map((category) => dataMap.get(category) ?? 0),
          name: groupName,
          stack: stack ? "Total" : undefined,
          type: "bar",
        };
      });
    } else {
      categories = data.map((item) => item.category);
      series = [
        {
          data: data.map((item) => item.value),
          type: "bar",
          barMaxWidth: 56,
          itemStyle: { borderRadius: [4, 4, 0, 0] },
        },
      ];
    }

    const echartsOption = {
      legend: hasGroups && (group || stack) ? { left: "center", orient: "horizontal", bottom: 12 } : undefined,
      series,
      title: { left: "center", text: title },
      tooltip: { trigger: "axis" },
      xAxis: {
        data: categories,
        name: axisXTitle,
        nameGap: 36,
        nameLocation: "middle",
        type: "category",
        axisLabel: { interval: 0 },
      },
      yAxis: { name: axisYTitle, type: "value" },
    };

    return generateChartImage(echartsOption, width, height, theme, outputType, "generate_bar_chart");
  },
};

export const generatePieChartTool = {
  name: "generate_pie_chart",
  description: "Generate a pie chart to show the proportion of parts.",
  inputSchema: z.object({
    data: flexibleArray(categoryValueSchema.omit({ group: true }), "Data for pie chart.", "Pie chart data cannot be empty."),
    innerRadius: z.number().optional().default(0),
    ...chartBase,
  }),
  run: async ({ data, height, innerRadius = 0, theme, title, width, outputType }) => {
    const echartsOption = {
      legend: { left: "center", orient: "horizontal", top: "bottom" },
      series: [
        {
          data: data.map((item) => ({ name: item.category, value: item.value })),
          radius: innerRadius > 0 ? [`${innerRadius * 100}%`, "70%"] : "70%",
          type: "pie",
        },
      ],
      title: { left: "center", text: title },
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    };
    return generateChartImage(echartsOption, width, height, theme, outputType, "generate_pie_chart");
  },
};

export const generateRadarChartTool = {
  name: "generate_radar_chart",
  description: "Generate a radar chart to display multidimensional data.",
  inputSchema: z.object({
    data: flexibleArray(
      z.object({
        name: z.string(),
        value: z.number(),
        group: z.string().optional(),
      }),
      "Data for radar chart.",
      "Radar chart data cannot be empty.",
    ),
    ...chartBase,
  }),
  run: async ({ data, height, theme, title, width, outputType }) => {
    const hasGroups = data.some((item) => item.group);
    const dimensions = Array.from(new Set(data.map((item) => item.name))).sort();
    const maxValue = Math.max(...data.map((item) => item.value));
    const indicator = dimensions.map((name) => ({ name, max: Math.ceil((maxValue * 1.2) / 10) * 10 || 10 }));
    const seriesData = hasGroups ? groupedValues(data, "group", "name", dimensions, 0) : [{ name: title || "Data", value: dimensions.map((name) => data.find((item) => item.name === name)?.value ?? 0) }];
    const echartsOption = {
      legend: hasGroups ? { left: "center", orient: "horizontal", bottom: "5%" } : undefined,
      radar: { indicator, radius: "60%", splitNumber: 4 },
      series: [{ data: seriesData, type: "radar" }],
      title: { left: "center", text: title, top: "5%" },
      tooltip: { trigger: "item" },
    };
    return generateChartImage(echartsOption, width, height, theme, outputType, "generate_radar_chart");
  },
};

export const generateScatterChartTool = {
  name: "generate_scatter_chart",
  description: "Generate a scatter chart to show the relationship between two variables.",
  inputSchema: z.object({
    axisXTitle: AxisXTitleSchema,
    axisYTitle: AxisYTitleSchema,
    data: flexibleArray(
      z.object({ x: z.number(), y: z.number() }),
      "Data for scatter chart.",
      "Scatter chart data cannot be empty.",
    ),
    ...chartBase,
  }),
  run: async ({ axisXTitle, axisYTitle, data, height, theme, title, width, outputType }) => {
    const echartsOption = {
      series: [{ data: data.map((item) => [item.x, item.y]), type: "scatter", symbolSize: 8 }],
      title: { left: "center", text: title },
      tooltip: { trigger: "item" },
      xAxis: { name: axisXTitle, nameGap: 36, nameLocation: "middle", type: "value", scale: true },
      yAxis: { name: axisYTitle, type: "value", scale: true },
    };
    return generateChartImage(echartsOption, width, height, theme, outputType, "generate_scatter_chart");
  },
};

export const generateSankeyChartTool = {
  name: "generate_sankey_chart",
  description: "Generate a sankey chart to visualize flows between stages or categories.",
  inputSchema: z.object({
    data: flexibleArray(
      z.object({ source: z.string(), target: z.string(), value: z.number() }),
      "Data for sankey chart.",
      "Sankey chart data cannot be empty.",
    ),
    nodeAlign: z.enum(["left", "right", "justify"]).optional().default("justify"),
    ...chartBase,
  }),
  run: async ({ data, height, nodeAlign = "justify", theme, title, width, outputType }) => {
    const nodeSet = new Set();
    for (const item of data) {
      nodeSet.add(item.source);
      nodeSet.add(item.target);
    }
    const echartsOption = {
      series: [
        {
          type: "sankey",
          data: Array.from(nodeSet).map((name) => ({ name })),
          links: data,
          nodeAlign,
          emphasis: { focus: "adjacency" },
          lineStyle: { color: "gradient", curveness: 0.5 },
        },
      ],
      title: { left: "center", text: title },
      tooltip: { trigger: "item", triggerOn: "mousemove" },
    };
    return generateChartImage(echartsOption, width, height, theme, outputType, "generate_sankey_chart");
  },
};

export const generateFunnelChartTool = {
  name: "generate_funnel_chart",
  description: "Generate a funnel chart to visualize progressive reduction across stages.",
  inputSchema: z.object({
    data: flexibleArray(categoryValueSchema.omit({ group: true }), "Data for funnel chart.", "Funnel chart data cannot be empty."),
    ...chartBase,
  }),
  run: async ({ data, height, theme, title, width, outputType }) => {
    const funnelData = data.map((item) => ({ name: item.category, value: item.value }));
    const echartsOption = {
      series: [
        {
          type: "funnel",
          data: funnelData,
          left: "10%",
          top: 70,
          width: "80%",
          height: "72%",
          max: Math.max(...data.map((item) => item.value)),
          sort: "descending",
          label: { show: true, position: "inside", color: "#fff" },
        },
      ],
      title: { left: "center", text: title },
      tooltip: { trigger: "item" },
      legend: { left: "center", orient: "horizontal", bottom: 10, data: funnelData.map((item) => item.name) },
    };
    return generateChartImage(echartsOption, width, height, theme, outputType, "generate_funnel_chart");
  },
};

export const generateGaugeChartTool = {
  name: "generate_gauge_chart",
  description: "Generate a gauge chart to display indicator status.",
  inputSchema: z.object({
    data: flexibleArray(z.object({ name: z.string(), value: z.number() }), "Data for gauge chart.", "Gauge chart data cannot be empty."),
    max: z.number().optional().default(100),
    min: z.number().optional().default(0),
    ...chartBase,
  }),
  run: async ({ data, height, max = 100, min = 0, theme, title, width, outputType }) => {
    const echartsOption = {
      legend: data.length > 1 ? { bottom: 10, left: "center", data: data.map((item) => item.name) } : undefined,
      series: data.map((item, index) => ({
        name: item.name,
        type: "gauge",
        data: [{ name: item.name, value: item.value }],
        center: data.length > 1 ? [`${(100 / (data.length + 1)) * (index + 1)}%`, "60%"] : ["50%", "55%"],
        radius: data.length > 1 ? `${Math.min(80 / data.length, 30)}%` : "80%",
        min,
        max,
        startAngle: 180,
        endAngle: 0,
        detail: { formatter: "{value}", fontSize: data.length > 1 ? 16 : 20, offsetCenter: [0, "30%"] },
        title: { offsetCenter: [0, "50%"] },
      })),
      title: { left: "center", text: title },
    };
    return generateChartImage(echartsOption, width, height, theme, outputType, "generate_gauge_chart");
  },
};

export const generateTreemapChartTool = {
  name: "generate_treemap_chart",
  description: "Generate a treemap chart to display hierarchical data.",
  inputSchema: z.object({
    data: flexibleArray(createHierarchicalSchema("Node name.", "Node value.", false), "Data for treemap chart.", "Treemap chart data cannot be empty."),
    ...chartBase,
  }),
  run: async ({ data, height, theme, title, width, outputType }) => generateChartImage({
    series: [{ type: "treemap", data, left: "3%", right: "3%", bottom: "3%", label: { show: true, formatter: "{b}" }, breadcrumb: { show: false } }],
    title: { left: "center", text: title },
    tooltip: { trigger: "item" },
  }, width, height, theme, outputType, "generate_treemap_chart"),
};

export const generateSunburstChartTool = {
  name: "generate_sunburst_chart",
  description: "Generate a sunburst chart to display multi-level hierarchical data.",
  inputSchema: z.object({
    data: flexibleArray(createHierarchicalSchema("Node name.", "Node value.", false), "Data for sunburst chart.", "Sunburst chart data cannot be empty."),
    ...chartBase,
  }),
  run: async ({ data, height, theme, title, width, outputType }) => generateChartImage({
    series: [{ type: "sunburst", data, radius: [0, "90%"], label: { show: true, minAngle: 10 } }],
    title: { left: "center", text: title },
    tooltip: { trigger: "item" },
  }, width, height, theme, outputType, "generate_sunburst_chart"),
};

export const generateHeatmapChartTool = {
  name: "generate_heatmap_chart",
  description: "Generate a heatmap chart to display intensity distribution.",
  inputSchema: z.object({
    axisXTitle: AxisXTitleSchema,
    axisYTitle: AxisYTitleSchema,
    data: flexibleArray(
      z.object({ x: z.union([z.string(), z.number()]), y: z.union([z.string(), z.number()]), value: z.number() }),
      "Data for heatmap chart.",
      "Heatmap chart data cannot be empty.",
    ),
    ...chartBase,
  }),
  run: async ({ axisXTitle, axisYTitle, data, height, theme, title, width, outputType }) => {
    const xValues = Array.from(new Set(data.map((item) => item.x))).sort();
    const yValues = Array.from(new Set(data.map((item) => item.y))).sort();
    const dataMap = new Map(data.map((item) => [`${item.x}_${item.y}`, item.value]));
    const heatmapData = xValues.flatMap((x, i) => yValues.map((y, j) => [i, j, dataMap.get(`${x}_${y}`) || 0]));
    const values = data.map((item) => item.value);
    const echartsOption = {
      grid: { height: "60%", top: "15%", right: "15%", bottom: "12%" },
      series: [{ type: "heatmap", data: heatmapData, label: { show: true, fontSize: 10 } }],
      title: { left: "center", text: title, top: "3%" },
      tooltip: { position: "top" },
      visualMap: { min: Math.min(...values), max: Math.max(...values), calculable: true, orient: "horizontal", left: "center", bottom: "4%" },
      xAxis: { type: "category", data: xValues, name: axisXTitle, splitArea: { show: true } },
      yAxis: { type: "category", data: yValues, name: axisYTitle, splitArea: { show: true } },
    };
    return generateChartImage(echartsOption, width, height, theme, outputType, "generate_heatmap_chart");
  },
};

export const generateCandlestickChartTool = {
  name: "generate_candlestick_chart",
  description: "Generate a candlestick chart for OHLC financial data.",
  inputSchema: z.object({
    data: flexibleArray(
      z.object({ date: z.string(), open: z.number(), high: z.number(), low: z.number(), close: z.number(), volume: z.number().optional() }),
      "Data for candlestick chart.",
      "Candlestick chart data cannot be empty.",
    ),
    showVolume: z.boolean().optional().default(false),
    ...chartBase,
  }),
  run: async ({ data, height, showVolume = false, theme, title, width, outputType }) => {
    const sortedData = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const dates = sortedData.map((item) => item.date);
    const ohlcData = sortedData.map((item) => [item.open, item.close, item.low, item.high]);
    const volumeData = sortedData.map((item) => item.volume || 0);
    const series = [{ name: "Candlestick", type: "candlestick", data: ohlcData }];
    if (showVolume && volumeData.some((value) => value > 0)) {
      series.push({ name: "Volume", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: volumeData, barWidth: "60%" });
    }
    const echartsOption = {
      legend: { bottom: 10, left: "center", data: showVolume ? ["Candlestick", "Volume"] : ["Candlestick"] },
      tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
      xAxis: [{ type: "category", data: dates }, ...(showVolume ? [{ type: "category", gridIndex: 1, data: dates, axisLabel: { show: false } }] : [])],
      yAxis: [{ scale: true }, ...(showVolume ? [{ scale: true, gridIndex: 1, axisLabel: { show: false } }] : [])],
      grid: showVolume ? [{ left: "12%", right: "10%", top: "15%", height: "50%" }, { left: "12%", right: "10%", top: "75%", height: "15%" }] : [{ left: "12%", right: "10%", top: "15%", bottom: "15%" }],
      series,
      title: { left: "center", text: title },
    };
    return generateChartImage(echartsOption, width, height, theme, outputType, "generate_candlestick_chart");
  },
};

export const generateBoxplotChartTool = {
  name: "generate_boxplot_chart",
  description: "Generate a boxplot chart for statistical summaries across categories.",
  inputSchema: z.object({
    axisXTitle: AxisXTitleSchema,
    axisYTitle: AxisYTitleSchema,
    data: flexibleArray(categoryValueSchema, "Data for boxplot chart.", "Boxplot chart data cannot be empty."),
    ...chartBase,
  }),
  run: async ({ axisXTitle, axisYTitle, data, height, theme, title, width, outputType }) => {
    const categoryMap = new Map();
    for (const item of data) {
      if (!categoryMap.has(item.category)) categoryMap.set(item.category, []);
      categoryMap.get(item.category).push(item.value);
    }
    const categories = Array.from(categoryMap.keys()).sort();
    const boxplotData = categories.map((category) => ({ name: category, value: boxplotStats(categoryMap.get(category).sort((a, b) => a - b)) }));
    const echartsOption = {
      series: [{ type: "boxplot", data: boxplotData, itemStyle: { borderWidth: 2 } }],
      title: { left: "center", text: title },
      tooltip: { trigger: "item" },
      xAxis: { type: "category", data: categories, name: axisXTitle, boundaryGap: true },
      yAxis: { type: "value", name: axisYTitle, splitArea: { show: true } },
    };
    return generateChartImage(echartsOption, width, height, theme, outputType, "generate_boxplot_chart");
  },
};

export const generateGraphChartTool = {
  name: "generate_graph_chart",
  description: "Generate a network graph chart to show relationships between entities.",
  inputSchema: z.object({
    data: flexibleObject(
      z.object({
        nodes: z.array(z.object({ id: z.string(), name: z.string(), value: z.number().optional(), category: z.string().optional() })).nonempty(),
        edges: z.array(z.object({ source: z.string(), target: z.string(), value: z.number().optional() })).optional().default([]),
      }),
      "Data for network graph chart.",
    ),
    layout: z.enum(["force", "circular", "none"]).optional().default("force"),
    ...chartBase,
  }),
  run: async ({ data, height, layout = "force", theme, title, width, outputType }) => {
    const nodeIds = new Set(data.nodes.map((node) => node.id));
    const categories = Array.from(new Set(data.nodes.map((node) => node.category).filter(Boolean)));
    const echartsOption = {
      series: [
        {
          type: "graph",
          data: data.nodes.map((node) => ({ ...node, symbolSize: node.value ? Math.sqrt(node.value) * 10 : 20 })),
          links: data.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
          categories: categories.map((name) => ({ name })),
          roam: true,
          layout,
          force: layout === "force" ? { repulsion: 100, gravity: 0.02, edgeLength: 150, layoutAnimation: false } : undefined,
          label: { show: true, position: "right", formatter: "{b}" },
          lineStyle: { color: "source", curveness: 0.3 },
        },
      ],
      title: { left: "center", text: title },
      tooltip: { trigger: "item" },
      legend: categories.length ? { left: "center", orient: "horizontal", bottom: 10, data: categories } : undefined,
    };
    return generateChartImage(echartsOption, width, height, theme, outputType, "generate_graph_chart");
  },
};

export const generateParallelChartTool = {
  name: "generate_parallel_chart",
  description: "Generate a parallel coordinates chart to display multi-dimensional data.",
  inputSchema: z.object({
    data: flexibleArray(
      z.object({ name: z.string(), values: z.array(z.number()) }),
      "Data for parallel chart.",
      "Parallel chart data cannot be empty.",
    ),
    dimensions: z.union([z.array(z.string()), stringifiedJson.pipe(z.array(z.string()))]).refine((value) => value.length > 0, { message: "At least one dimension is required." }),
    ...chartBase,
  }),
  run: async ({ data, dimensions, height, theme, title, width, outputType }) => {
    const parallelAxis = dimensions.map((name, index) => {
      const values = data.map((item) => item.values[index]).filter((value) => value !== undefined);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = max - min || 1;
      return { dim: index, name, min: min - range * 0.1, max: max + range * 0.1 };
    });
    const echartsOption = {
      parallelAxis,
      parallel: { left: "5%", right: "13%", bottom: "20%", top: "15%" },
      series: data.map((item) => ({ name: item.name, type: "parallel", data: [{ name: item.name, value: item.values }], smooth: true })),
      title: { left: "center", text: title },
      tooltip: { trigger: "item" },
      legend: { bottom: 30, data: data.map((item) => item.name) },
    };
    return generateChartImage(echartsOption, width, height, theme, outputType, "generate_parallel_chart");
  },
};

export const generateTreeChartTool = {
  name: "generate_tree_chart",
  description: "Generate a tree chart to display hierarchical data structures.",
  inputSchema: z.object({
    data: flexibleObject(createHierarchicalSchema("Node name.", "Node value.", true), "Tree data structure."),
    layout: z.enum(["orthogonal", "radial"]).optional().default("orthogonal"),
    orient: z.enum(["LR", "RL", "TB", "BT"]).optional().default("LR"),
    ...chartBase,
  }),
  run: async ({ data, height, layout = "orthogonal", orient = "LR", theme, title, width, outputType }) => {
    const echartsOption = {
      series: [{ type: "tree", data: [data], layout, orient, symbol: "emptyCircle", symbolSize: 7, initialTreeDepth: -1, label: { fontSize: 12 }, expandAndCollapse: true }],
      title: { left: "center", text: title },
      tooltip: { trigger: "item", triggerOn: "mousemove" },
    };
    return generateChartImage(echartsOption, width, height, theme, outputType, "generate_tree_chart");
  },
};

export const tools = [
  generateEChartsTool,
  generateAreaChartTool,
  generateLineChartTool,
  generateBarChartTool,
  generatePieChartTool,
  generateRadarChartTool,
  generateScatterChartTool,
  generateSankeyChartTool,
  generateFunnelChartTool,
  generateGaugeChartTool,
  generateTreemapChartTool,
  generateSunburstChartTool,
  generateHeatmapChartTool,
  generateCandlestickChartTool,
  generateBoxplotChartTool,
  generateGraphChartTool,
  generateParallelChartTool,
  generateTreeChartTool,
];

export const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

function runLineLike({ axisXTitle, axisYTitle, data, height, showArea, showSymbol, smooth, stack, theme, title, width, outputType }, toolName) {
  const hasGroups = data.some((item) => item.group);
  let categories = [];
  let series = [];

  if (hasGroups) {
    const groupMap = new Map();
    const timeSet = new Set();
    for (const item of data) {
      const groupName = item.group || "Default";
      if (!groupMap.has(groupName)) groupMap.set(groupName, []);
      groupMap.get(groupName).push({ time: item.time, value: item.value });
      timeSet.add(item.time);
    }
    categories = Array.from(timeSet).sort();
    series = Array.from(groupMap.entries()).map(([groupName, groupData]) => {
      const dataMap = new Map(groupData.map((item) => [item.time, item.value]));
      return {
        areaStyle: showArea ? {} : undefined,
        connectNulls: false,
        data: categories.map((time) => dataMap.get(time) ?? null),
        name: groupName,
        showSymbol,
        smooth,
        stack: stack ? "Total" : undefined,
        type: "line",
      };
    });
  } else {
    categories = data.map((item) => item.time);
    series = [{
      areaStyle: showArea ? {} : undefined,
      data: data.map((item) => item.value),
      showSymbol,
      smooth,
      stack: stack ? "Total" : undefined,
      type: "line",
    }];
  }

  const echartsOption = {
    legend: hasGroups ? { left: "center", orient: "horizontal", bottom: 12 } : undefined,
    series,
    title: { left: "center", text: title },
    tooltip: { trigger: "axis" },
    xAxis: { boundaryGap: false, data: categories, name: axisXTitle, nameGap: 36, nameLocation: "middle", type: "category" },
    yAxis: { name: axisYTitle, type: "value" },
  };

  return generateChartImage(echartsOption, width, height, theme, outputType, toolName);
}

function groupedValues(data, groupKey, dimensionKey, dimensions, fallback) {
  const groupMap = new Map();
  for (const item of data) {
    const groupName = item[groupKey] || "Default";
    if (!groupMap.has(groupName)) groupMap.set(groupName, []);
    groupMap.get(groupName).push(item);
  }
  return Array.from(groupMap.entries()).map(([groupName, groupData]) => ({
    name: groupName,
    value: dimensions.map((dimension) => groupData.find((item) => item[dimensionKey] === dimension)?.value ?? fallback),
  }));
}

function boxplotStats(values) {
  const len = values.length;
  const min = values[0];
  const max = values[len - 1];
  const median = len % 2 === 0 ? (values[len / 2 - 1] + values[len / 2]) / 2 : values[Math.floor(len / 2)];
  return [min, values[Math.floor(len / 4)], median, values[Math.floor((3 * len) / 4)], max];
}
