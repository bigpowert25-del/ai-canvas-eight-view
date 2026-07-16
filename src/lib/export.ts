import JSZip from "jszip";
import type { ConsistencyReport } from "./images";
import { safeAssetName, type ViewTask, type WorkspaceSettings } from "./views";

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveDataUrl(dataUrl: string, filename: string) {
  saveBlob(await (await fetch(dataUrl)).blob(), filename);
}

export async function exportZip(input: {
  tasks: ViewTask[];
  settings: WorkspaceSettings;
  referenceName: string;
  providerModel?: string;
  report?: ConsistencyReport;
}) {
  const zip = new JSZip();
  const images = zip.folder("views");
  for (const [index, task] of input.tasks.entries()) {
    if (!task.imageDataUrl) continue;
    const blob = await (await fetch(task.imageDataUrl)).blob();
    images?.file(safeAssetName(index, task), blob);
  }
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        schema: "ai-canvas-eight-view/v1",
        exportedAt: new Date().toISOString(),
        reference: input.referenceName,
        provider: input.settings.provider,
        model: input.providerModel,
        quality: input.settings.quality,
        views: input.tasks.map((task, index) => ({
          id: task.id,
          name: task.name,
          angle: task.angle,
          filename: task.imageDataUrl ? `views/${safeAssetName(index, task)}` : null,
          revision: task.revision,
          status: task.status,
        })),
      },
      null,
      2,
    ),
  );
  if (input.report) {
    zip.file("consistency-report.json", JSON.stringify(input.report, null, 2));
  }
  saveBlob(await zip.generateAsync({ type: "blob" }), "ai-canvas-eight-view.zip");
}
