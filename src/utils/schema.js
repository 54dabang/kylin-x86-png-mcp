import { z } from "zod";

export const AxisXTitleSchema = z.string().optional().default("").describe("Set the x-axis title of chart.");
export const AxisYTitleSchema = z.string().optional().default("").describe("Set the y-axis title of chart.");
export const HeightSchema = z.number().int().positive().optional().default(600).describe("Set the height of the chart, default is 600px.");
export const ThemeSchema = z.enum(["default", "dark"]).optional().default("default").describe("Set the theme for the chart, optional, default is 'default'.");
export const OutputTypeSchema = z.enum(["png", "svg", "option"]).optional().default("png").describe("The output type of the chart. Default is 'png'. This server renders PNG through ECharts SVG SSR and rsvg-convert, never through canvas.");
export const TitleSchema = z.string().optional().describe("Set the title of the chart.");
export const WidthSchema = z.number().int().positive().optional().default(800).describe("Set the width of the chart, default is 800px.");

export function createHierarchicalSchema(nameDesc, valueDesc, valueOptional, depth = 5) {
  let currentLevel = z.object({
    name: z.string().describe(nameDesc),
    value: valueOptional ? z.number().optional().describe(valueDesc) : z.number().describe(valueDesc),
  });

  for (let i = depth - 1; i >= 1; i -= 1) {
    const childLevel = currentLevel;
    currentLevel = z.object({
      name: z.string().describe(nameDesc),
      value: valueOptional ? z.number().optional().describe(valueDesc) : z.number().describe(valueDesc),
      children: z.array(childLevel).optional().describe("Child nodes for hierarchical structure."),
    });
  }

  return currentLevel;
}
