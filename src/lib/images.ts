import type { ViewTask } from "./views";

export interface ImageStats {
  width: number;
  height: number;
  meanLightness: number;
  backgroundDeviation: number;
  foregroundCoverage: number;
  edgeMargin: number;
}

export interface ViewCheck {
  id: string;
  name: string;
  score: number;
  checks: {
    square: boolean;
    resolution: boolean;
    background: boolean;
    framing: boolean;
    tone: boolean;
  };
  stats?: ImageStats;
}

export interface ConsistencyReport {
  score: number;
  passed: number;
  total: number;
  checks: ViewCheck[];
  generatedAt: string;
}

export function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图像无法读取。"));
    image.src = source;
  });
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("文件无法读取。"));
    reader.readAsDataURL(file);
  });
}

export async function rasterizeToPng(
  source: string,
  name: string,
  maxDimension = 2048,
): Promise<{ file: File; dataUrl: string }> {
  const image = await loadImage(source);
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("浏览器不支持图像转换。");
  context.fillStyle = "#e8ebea";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/png");
  return { file: await dataUrlToFile(dataUrl, name), dataUrl };
}

export async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const response = await fetch(dataUrl);
  return new File([await response.blob()], name, { type: response.headers.get("content-type") || "image/png" });
}

export async function splitContactSheet(
  source: string,
  trimPercent: number,
): Promise<string[]> {
  const image = await loadImage(source);
  const columns = 4;
  const rows = 2;
  const cellWidth = image.naturalWidth / columns;
  const cellHeight = image.naturalHeight / rows;
  const insetX = cellWidth * (trimPercent / 100);
  const insetY = cellHeight * (trimPercent / 100);

  return Array.from({ length: 8 }, (_, index) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器不支持图像切格。 ");

    const column = index % columns;
    const row = Math.floor(index / columns);
    context.fillStyle = "#e8ebea";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      column * cellWidth + insetX,
      row * cellHeight + insetY,
      cellWidth - insetX * 2,
      cellHeight - insetY * 2,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas.toDataURL("image/png");
  });
}

function colorDistance(a: number[], b: number[]) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

export async function inspectImage(source: string): Promise<ImageStats> {
  const image = await loadImage(source);
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器不支持像素检查。");
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const cornerPoints = [0, size - 1, size * (size - 1), size * size - 1];
  const background = [0, 0, 0];
  for (const point of cornerPoints) {
    background[0] += pixels[point * 4];
    background[1] += pixels[point * 4 + 1];
    background[2] += pixels[point * 4 + 2];
  }
  background[0] /= 4;
  background[1] /= 4;
  background[2] /= 4;

  let mean = 0;
  let deviation = 0;
  let backgroundSamples = 0;
  let foreground = 0;
  let minX = size;
  let minY = size;
  let maxX = 0;
  let maxY = 0;
  for (let index = 0; index < size * size; index += 1) {
    const rgb = [pixels[index * 4], pixels[index * 4 + 1], pixels[index * 4 + 2]];
    mean += rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    const distance = colorDistance(rgb, background);
    const x = index % size;
    const y = Math.floor(index / size);
    if (x < 5 || x >= size - 5 || y < 5 || y >= size - 5) {
      deviation += distance;
      backgroundSamples += 1;
    }
    if (distance > 34) {
      foreground += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const edgeMargin = foreground
    ? Math.max(0, Math.min(minX, minY, size - 1 - maxX, size - 1 - maxY) / size)
    : 0;

  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    meanLightness: mean / (size * size),
    backgroundDeviation: deviation / Math.max(1, backgroundSamples),
    foregroundCoverage: foreground / (size * size),
    edgeMargin,
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function buildConsistencyReport(tasks: ViewTask[]): Promise<ConsistencyReport> {
  const stats = await Promise.all(
    tasks.map((task) => (task.imageDataUrl ? inspectImage(task.imageDataUrl).catch(() => undefined) : undefined)),
  );
  const baseline = median(stats.filter(Boolean).map((item) => item!.meanLightness));
  const checks = tasks.map<ViewCheck>((task, index) => {
    const item = stats[index];
    if (!item) {
      return {
        id: task.id,
        name: task.name,
        score: 0,
        checks: { square: false, resolution: false, background: false, framing: false, tone: false },
      };
    }
    const results = {
      square: Math.abs(item.width / item.height - 1) < 0.02,
      resolution: Math.min(item.width, item.height) >= 768,
      background: item.backgroundDeviation < 34,
      framing: item.foregroundCoverage > 0.12 && item.foregroundCoverage < 0.72 && item.edgeMargin >= 0.01,
      tone: Math.abs(item.meanLightness - baseline) < 28,
    };
    const score = Math.round((Object.values(results).filter(Boolean).length / 5) * 100);
    return { id: task.id, name: task.name, score, checks: results, stats: item };
  });
  const score = Math.round(checks.reduce((sum, item) => sum + item.score, 0) / checks.length);
  return {
    score,
    passed: checks.filter((item) => item.score === 100).length,
    total: checks.length,
    checks,
    generatedAt: new Date().toISOString(),
  };
}
