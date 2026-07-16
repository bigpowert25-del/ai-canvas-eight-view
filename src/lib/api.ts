import type { Quality, ProviderId } from "./views";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  available: boolean;
  model: string;
  detail?: string;
  capabilities?: {
    generate: boolean;
    handoff: boolean;
  };
}

export interface ProviderResponse {
  imageDataUrl: string;
  provider: string;
  model: string;
}

export interface ComfyHandoffResponse {
  promptId: string;
  workflow: string;
  uploaded: Array<{ id: string; path: string }>;
}

async function apiResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `请求失败 (${response.status})`);
  }
  return body as T;
}

export async function getProviders(): Promise<ProviderInfo[]> {
  const response = await fetch("/api/providers");
  const body = await apiResponse<{ providers: ProviderInfo[] }>(response);
  return body.providers;
}

export async function generateContactSheet(input: {
  reference: File;
  provider: ProviderId;
  prompt: string;
  quality: Quality;
  seed: number;
}): Promise<ProviderResponse> {
  const formData = new FormData();
  formData.append("reference", input.reference);
  formData.append(
    "config",
    JSON.stringify({
      provider: input.provider,
      prompt: input.prompt,
      quality: input.quality,
      seed: input.seed,
    }),
  );
  return apiResponse<ProviderResponse>(
    await fetch("/api/generate-contact-sheet", { method: "POST", body: formData }),
  );
}

export async function generateSingleView(input: {
  reference: File;
  contextSheet?: File;
  provider: ProviderId;
  viewId: string;
  prompt: string;
  quality: Quality;
  seed: number;
}): Promise<ProviderResponse> {
  const formData = new FormData();
  formData.append("reference", input.reference);
  if (input.contextSheet) formData.append("contextSheet", input.contextSheet);
  formData.append(
    "config",
    JSON.stringify({
      provider: input.provider,
      viewId: input.viewId,
      prompt: input.prompt,
      quality: input.quality,
      seed: input.seed,
    }),
  );
  return apiResponse<ProviderResponse>(
    await fetch("/api/generate-view", { method: "POST", body: formData }),
  );
}

export async function publishViewsToComfyUI(
  views: Array<{ id: string; filename: string; imageDataUrl: string }>,
): Promise<ComfyHandoffResponse> {
  const formData = new FormData();
  for (const view of views) {
    const blob = await (await fetch(view.imageDataUrl)).blob();
    formData.append("views", new File([blob], view.filename, { type: "image/png" }));
  }
  formData.append("config", JSON.stringify({ viewIds: views.map((view) => view.id) }));
  return apiResponse<ComfyHandoffResponse>(
    await fetch("/api/comfyui/publish-views", { method: "POST", body: formData }),
  );
}
