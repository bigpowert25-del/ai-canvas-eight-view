import { describe, expect, it } from "vitest";
import {
  buildContactSheetPrompt,
  buildSingleViewPrompt,
  createViewTasks,
  DEFAULT_SETTINGS,
  safeAssetName,
  VIEW_SPECS,
} from "./views";

describe("eight-view task configuration", () => {
  it("defines the full clockwise turntable exactly once", () => {
    expect(VIEW_SPECS).toHaveLength(8);
    expect(new Set(VIEW_SPECS.map((view) => view.id)).size).toBe(8);
    expect(VIEW_SPECS.map((view) => view.id)).toEqual([
      "front",
      "front-right",
      "right",
      "back-right",
      "back",
      "back-left",
      "left",
      "front-left",
    ]);
  });

  it("builds a strict 4 by 2 contact-sheet prompt with per-view constraints", () => {
    const tasks = createViewTasks();
    tasks[1].instruction = "keep the shoulder patch visible";
    const prompt = buildContactSheetPrompt(DEFAULT_SETTINGS, tasks);

    expect(prompt).toContain("4 columns by 2 rows");
    expect(prompt).toContain("exactly eight views");
    expect(prompt).toContain("Cell 2: front-right three-quarter view");
    expect(prompt).toContain("keep the shoulder patch visible");
    expect(prompt).toContain("Do not place any text");
  });

  it("builds a single-view repair prompt that uses contact-sheet context", () => {
    const prompt = buildSingleViewPrompt(DEFAULT_SETTINGS, createViewTasks()[4], true);
    expect(prompt).toContain("straight-on back view");
    expect(prompt).toContain("second image as the current eight-view contact sheet");
  });

  it("generates stable PNG filenames", () => {
    expect(safeAssetName(0, createViewTasks()[0])).toBe("01-front.png");
    expect(safeAssetName(7, createViewTasks()[7])).toBe("08-front-left.png");
  });
});
