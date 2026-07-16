export type ProviderId = "mock" | "comfyui" | "openai";
export type Quality = "low" | "medium" | "high";
export type TaskStatus = "empty" | "ready" | "review" | "approved" | "error" | "generating";

export interface WorkspaceSettings {
  provider: ProviderId;
  quality: Quality;
  style: string;
  characterLock: string;
  background: string;
  negativeConstraints: string;
  trimPercent: number;
  seed: number;
}

export interface ViewSpec {
  id: string;
  name: string;
  angle: string;
  camera: string;
}

export interface ViewTask extends ViewSpec {
  instruction: string;
  status: TaskStatus;
  imageDataUrl?: string;
  revision: number;
  provider?: string;
  model?: string;
}

export const VIEW_SPECS: ViewSpec[] = [
  { id: "front", name: "正面", angle: "0°", camera: "straight-on front view" },
  { id: "front-right", name: "右前 45°", angle: "+45°", camera: "front-right three-quarter view" },
  { id: "right", name: "右侧", angle: "+90°", camera: "exact right profile view" },
  { id: "back-right", name: "右后 45°", angle: "+135°", camera: "back-right three-quarter view" },
  { id: "back", name: "背面", angle: "180°", camera: "straight-on back view" },
  { id: "back-left", name: "左后 45°", angle: "-135°", camera: "back-left three-quarter view" },
  { id: "left", name: "左侧", angle: "-90°", camera: "exact left profile view" },
  { id: "front-left", name: "左前 45°", angle: "-45°", camera: "front-left three-quarter view" },
];

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  provider: "mock",
  quality: "medium",
  style: "clean production character concept art, realistic materials, neutral studio lighting",
  characterLock: "Preserve the exact identity, face, hairstyle, outfit, proportions, accessories, colors and material details from the reference image.",
  background: "uniform light gray background, soft contact shadow only",
  negativeConstraints: "No text, labels, frame, crop, props, pose change, camera tilt, perspective distortion or extra limbs.",
  trimPercent: 1,
  seed: 24,
};

export function createViewTasks(): ViewTask[] {
  return VIEW_SPECS.map((view) => ({
    ...view,
    instruction: "",
    status: "empty",
    revision: 0,
  }));
}

export function buildContactSheetPrompt(settings: WorkspaceSettings, tasks: ViewTask[]): string {
  const layout = tasks
    .map((task, index) => `Cell ${index + 1}: ${task.camera}${task.instruction ? `. Extra constraint: ${task.instruction}` : ""}`)
    .join("\n");

  return [
    "Create one precise 4 columns by 2 rows character turntable contact sheet from the supplied reference image.",
    "Use equal square cells with no gutters. Show the complete character from head to toe in every cell, centered at the same scale and standing in the same relaxed neutral pose.",
    settings.characterLock,
    `Visual treatment: ${settings.style}.`,
    `Background: ${settings.background}.`,
    "Camera order must follow this exact clockwise sequence:",
    layout,
    settings.negativeConstraints,
    "The output must contain exactly eight views. Do not place any text, labels, numbers or borders inside the image.",
  ].join("\n");
}

export function buildSingleViewPrompt(
  settings: WorkspaceSettings,
  task: ViewTask,
  hasContextSheet: boolean,
): string {
  return [
    `Generate one square, full-body ${task.camera} of the character from the first reference image.`,
    hasContextSheet
      ? "Use the second image as the current eight-view contact sheet. Match its scale, pose, lighting, palette and established details."
      : "Match the reference image as closely as possible.",
    settings.characterLock,
    `Visual treatment: ${settings.style}.`,
    `Background: ${settings.background}.`,
    task.instruction ? `View-specific constraint: ${task.instruction}.` : "",
    settings.negativeConstraints,
    "Return only one centered square image with the complete character visible. Do not include text or a border.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function safeAssetName(index: number, task: ViewTask): string {
  return `${String(index + 1).padStart(2, "0")}-${task.id}.png`;
}
