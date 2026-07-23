import { renderChart } from "../src/utils/render.js";

const result = await renderChart(
  {
    title: { text: "报销金额排名前六名人员", left: "center" },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      name: "人员姓名",
      data: ["类兴邦", "肖棋元", "刘晶晶", "庄宇飞", "张兆乾", "彭子瑞"],
      axisLabel: { interval: 0 },
    },
    yAxis: { type: "value", name: "报销金额(万元)" },
    series: [{ type: "bar", data: [9.7, 8.52, 7.37, 6.97, 6.41, 5.01] }],
  },
  900,
  600,
  "default",
  "png",
  "smoke_bar_chart",
);

console.log(JSON.stringify(result, null, 2));
