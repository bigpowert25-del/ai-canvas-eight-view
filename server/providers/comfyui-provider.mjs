import { randomUUID } from "node:crypto";

const VIEW_VALUE_KEYS = {
  front: "viewFront",
  "front-right": "viewFrontRight",
  right: "viewRight",
  "back-right": "viewBackRight",
  back: "viewBack",
  "back-left": "viewBackLeft",
  left: "viewLeft",
  "front-left": "viewFrontLeft",
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function setAtPath(target, path, value) {
  const parts = String(path).split(".").filter(Boolean);
  if (parts.length === 0) throw new Error("ComfyUI binding path 不能为空。");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor || typeof cursor !== "object" || !(part in cursor)) {
      throw new Error(`ComfyUI binding path 不存在: ${path}`);
    }
    cursor = cursor[part];
  }
  const finalKey = parts.at(-1);
  if (!cursor || typeof cursor !== "object" || !(finalKey in cursor)) {
    throw new Error(`ComfyUI binding path 不存在: ${path}`);
  }
  cursor[finalKey] = value;
}

export function compileComfyPrompt({ workflowApi, bindings = {}, values = {} }) {
  if (!workflowApi || typeof workflowApi !== "object" || Array.isArray(workflowApi)) {
    throw new Error("ComfyUI API Format 工作流无效。");
  }
  const prompt = cloneJson(workflowApi);
  for (const [name, rawPaths] of Object.entries(bindings)) {
    if (!(name in values) || values[name] === undefined) continue;
    const paths = Array.isArray(rawPaths) ? rawPaths : [rawPaths];
    for (const path of paths) setAtPath(prompt, path, values[name]);
  }
  return prompt;
}

function normalizeBaseUrl(value) {
  const url = new URL(value || "http://127.0.0.1:8188");
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("ComfyUI 地址只支持 http 或 https。");
  }
  return url.toString().replace(/\/$/, "");
}

function qualitySteps(quality) {
  if (quality === "low") return 14;
  if (quality === "high") return 36;
  return 24;
}

function uploadedPath(result) {
  if (!result?.name) throw new Error("ComfyUI 上传响应缺少文件名。");
  return [result.subfolder, result.name].filter(Boolean).join("/");
}

function outputImages(historyEntry, outputNodeIds = []) {
  const outputs = historyEntry?.outputs || {};
  const orderedIds = [
    ...outputNodeIds.map(String),
    ...Object.keys(outputs).filter((id) => !outputNodeIds.map(String).includes(id)),
  ];
  const images = [];
  for (const nodeId of orderedIds) {
    for (const image of outputs[nodeId]?.images || []) {
      if (image?.filename) images.push(image);
    }
  }
  return images;
}

function historyError(historyEntry) {
  const status = historyEntry?.status;
  if (status?.status_str === "error") return "ComfyUI 工作流执行失败。";
  const messages = Array.isArray(status?.messages) ? status.messages : [];
  const executionError = messages.find((item) => item?.[0] === "execution_error");
  return executionError?.[1]?.exception_message || null;
}

async function responseJson(response, action) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || body?.error || body?.message || response.statusText;
    throw new Error(`${action}失败 (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return body;
}

async function comfyFetch(fetchFn, url, options, action) {
  try {
    return await fetchFn(url, options);
  } catch (error) {
    throw new Error(`${action}失败: ${String(error?.message || error)}`);
  }
}

export class ComfyUIProvider {
  id = "comfyui";

  constructor({
    baseUrl = "http://127.0.0.1:8188",
    clientId = "ai-canvas-local",
    contactWorkflow,
    viewWorkflow,
    handoffWorkflow,
    fetchFn = fetch,
    sleepFn = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    pollIntervalMs = 1000,
    timeoutMs = 10 * 60 * 1000,
  } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.clientId = clientId;
    this.contactWorkflow = contactWorkflow;
    this.viewWorkflow = viewWorkflow;
    this.handoffWorkflow = handoffWorkflow;
    this.fetchFn = fetchFn;
    this.sleepFn = sleepFn;
    this.pollIntervalMs = pollIntervalMs;
    this.timeoutMs = timeoutMs;
  }

  get generationConfigured() {
    return Boolean(this.contactWorkflow?.workflowApi && this.viewWorkflow?.workflowApi);
  }

  get handoffConfigured() {
    return Boolean(this.handoffWorkflow?.workflowApi);
  }

  async health(timeoutMs = 1500) {
    const response = await comfyFetch(this.fetchFn, `${this.baseUrl}/system_stats`, {
      signal: AbortSignal.timeout(timeoutMs),
    }, "ComfyUI 连接检查");
    return responseJson(response, "ComfyUI 连接检查");
  }

  async uploadImage(image, { filename, subfolder = "ai-canvas" } = {}) {
    if (!image?.buffer) throw new Error("ComfyUI 上传缺少图像数据。");
    const form = new FormData();
    const safeName = String(filename || image.originalname || "image.png").replace(/[^a-zA-Z0-9._-]/g, "-");
    form.append("image", new Blob([image.buffer], { type: image.mimetype || "image/png" }), safeName);
    form.append("type", "input");
    form.append("overwrite", "true");
    form.append("subfolder", subfolder);
    const response = await comfyFetch(
      this.fetchFn,
      `${this.baseUrl}/upload/image`,
      { method: "POST", body: form },
      "ComfyUI 图像上传",
    );
    return responseJson(response, "ComfyUI 图像上传");
  }

  async queue(prompt) {
    const response = await comfyFetch(this.fetchFn, `${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, client_id: this.clientId }),
    }, "ComfyUI 工作流排队");
    const body = await responseJson(response, "ComfyUI 工作流排队");
    if (!body.prompt_id) throw new Error("ComfyUI 排队响应缺少 prompt_id。");
    return body;
  }

  async history(promptId) {
    const response = await comfyFetch(
      this.fetchFn,
      `${this.baseUrl}/history/${encodeURIComponent(promptId)}`,
      undefined,
      "ComfyUI 历史查询",
    );
    return responseJson(response, "ComfyUI 历史查询");
  }

  async waitForImage(promptId, outputNodeIds = []) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.timeoutMs) {
      const history = await this.history(promptId);
      const entry = history[promptId];
      const error = historyError(entry);
      if (error) throw new Error(error);
      const images = outputImages(entry, outputNodeIds);
      if (images.length > 0) return images[0];
      if (entry?.status?.completed) {
        throw new Error("ComfyUI 工作流已完成，但没有找到图像输出。请检查 outputNodeIds 和 SaveImage/PreviewImage 节点。");
      }
      await this.sleepFn(this.pollIntervalMs);
    }
    throw new Error("ComfyUI 工作流等待超时。");
  }

  async downloadImage(image) {
    const query = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder || "",
      type: image.type || "output",
    });
    const response = await comfyFetch(
      this.fetchFn,
      `${this.baseUrl}/view?${query}`,
      undefined,
      "ComfyUI 图像读取",
    );
    if (!response.ok) throw new Error(`ComfyUI 图像读取失败 (${response.status})。`);
    const contentType = response.headers.get("content-type") || "image/png";
    const base64 = Buffer.from(await response.arrayBuffer()).toString("base64");
    return `data:${contentType};base64,${base64}`;
  }

  async runImageWorkflow(spec, values) {
    if (!spec?.workflowApi) throw new Error("ComfyUI 生成工作流未配置。请先填写 config/comfyui-provider.json。");
    const prompt = compileComfyPrompt({ workflowApi: spec.workflowApi, bindings: spec.bindings, values });
    const queued = await this.queue(prompt);
    const image = await this.waitForImage(queued.prompt_id, spec.outputNodeIds);
    return {
      imageDataUrl: await this.downloadImage(image),
      provider: this.id,
      model: spec.label || "ComfyUI API workflow",
      promptId: queued.prompt_id,
    };
  }

  async generateContactSheet({ reference, prompt, quality = "medium", seed = 24 }) {
    const runId = randomUUID();
    const uploaded = await this.uploadImage(reference, {
      filename: `reference-${runId}.png`,
      subfolder: `ai-canvas/${runId}`,
    });
    return this.runImageWorkflow(this.contactWorkflow, {
      positivePrompt: prompt,
      negativePrompt: "",
      referenceImage: uploadedPath(uploaded),
      seed,
      steps: qualitySteps(quality),
      width: 2048,
      height: 1024,
      outputPrefix: `ai-canvas/${runId}/contact-sheet`,
    });
  }

  async generateView({ reference, contextSheet, prompt, viewId, quality = "medium", seed = 24 }) {
    const runId = randomUUID();
    const uploadedReference = await this.uploadImage(reference, {
      filename: `reference-${runId}.png`,
      subfolder: `ai-canvas/${runId}`,
    });
    const uploadedContext = contextSheet
      ? await this.uploadImage(contextSheet, {
          filename: `contact-sheet-${runId}.png`,
          subfolder: `ai-canvas/${runId}`,
        })
      : undefined;
    return this.runImageWorkflow(this.viewWorkflow, {
      positivePrompt: prompt,
      negativePrompt: "",
      referenceImage: uploadedPath(uploadedReference),
      contextImage: uploadedContext ? uploadedPath(uploadedContext) : uploadedPath(uploadedReference),
      viewId,
      seed,
      steps: qualitySteps(quality),
      width: 1024,
      height: 1024,
      outputPrefix: `ai-canvas/${runId}/${viewId}`,
    });
  }

  async publishViews({ views }) {
    if (!this.handoffWorkflow?.workflowApi) throw new Error("ComfyUI 八视图交接工作流未配置。");
    if (!Array.isArray(views) || views.length !== 8) throw new Error("ComfyUI 交接需要正好 8 张视图。");
    const runId = randomUUID();
    const values = { outputPrefix: `ai-canvas/${runId}/eight-view` };
    const uploaded = [];
    for (const [index, view] of views.entries()) {
      const valueKey = VIEW_VALUE_KEYS[view.id];
      if (!valueKey) throw new Error(`未知八视图 ID: ${view.id}`);
      const result = await this.uploadImage(view, {
        filename: `${String(index + 1).padStart(2, "0")}-${view.id}.png`,
        subfolder: `ai-canvas/${runId}`,
      });
      const inputPath = uploadedPath(result);
      values[valueKey] = inputPath;
      uploaded.push({ id: view.id, path: inputPath });
    }
    const prompt = compileComfyPrompt({
      workflowApi: this.handoffWorkflow.workflowApi,
      bindings: this.handoffWorkflow.bindings,
      values,
    });
    const queued = await this.queue(prompt);
    return {
      promptId: queued.prompt_id,
      uploaded,
      workflow: this.handoffWorkflow.label || "AI Canvas eight-view loader",
    };
  }
}

export const COMFY_VIEW_VALUE_KEYS = VIEW_VALUE_KEYS;
