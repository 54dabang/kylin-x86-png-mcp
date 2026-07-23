import { config } from "../config.js";

export function withOfflineDefaults(option) {
  const next = {
    backgroundColor: option.backgroundColor ?? "#ffffff",
    ...option,
    animation: false,
  };

  next.textStyle = {
    fontFamily: config.fontFamily,
    ...(option.textStyle || {}),
  };

  if (next.title && typeof next.title === "object" && !Array.isArray(next.title)) {
    next.title = {
      ...next.title,
      top: next.title.top ?? 16,
      textStyle: {
        fontFamily: config.fontFamily,
        fontSize: 20,
        fontWeight: 600,
        ...(next.title.textStyle || {}),
      },
    };
  }

  if (next.grid === undefined && hasCartesianSeries(next)) {
    next.grid = {
      left: 68,
      right: 36,
      top: next.title?.text ? 78 : 46,
      bottom: next.legend ? 88 : 62,
      containLabel: true,
    };
  }

  return next;
}

function hasCartesianSeries(option) {
  const series = Array.isArray(option.series) ? option.series : [option.series].filter(Boolean);
  return series.some((item) => ["bar", "line", "scatter", "candlestick", "boxplot", "heatmap"].includes(item?.type));
}
