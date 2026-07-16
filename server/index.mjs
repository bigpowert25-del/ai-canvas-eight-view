import path from "node:path";
import process from "node:process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { ComfyUIProvider } from "./providers/comfyui-provider.mjs";
import { MockImageProvider } from "./providers/mock-provider.mjs";
import { OpenAIImageProvider } from "./providers/openai-provider.mjs";

try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isDev = process.argv.includes("--dev");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);

function projectFile(value) {
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("ComfyUI 配置和工作流必须位于 03-ai-canvas 目录内。");
  }
  return resolved;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function loadWorkflowSpec(raw) {
  if (!raw?.workflowApiPath) return undefined;
  const workflowPath = projectFile(raw.workflowApiPath);
  return {
    label: raw.label || path.basename(workflowPath),
    workflowApi: await readJson(workflowPath),
    bindings: raw.bindings || {},
    outputNodeIds: raw.outputNodeIds || [],
  };
}

const defaultHandoffWorkflow = {
  label: "AI Canvas eight-view loader",
  workflowApi: await readJson(projectFile("workflows/eight-view-loader_api.json")),
  bindings: {
    viewFront: ["1.inputs.image"],
    viewFrontRight: ["3.inputs.image"],
    viewRight: ["5.inputs.image"],
    viewBackRight: ["7.inputs.image"],
    viewBack: ["9.inputs.image"],
    viewBackLeft: ["11.inputs.image"],
    viewLeft: ["13.inputs.image"],
    viewFrontLeft: ["15.inputs.image"],
  },
};

const comfyConfigPath = projectFile(process.env.COMFYUI_CONFIG_PATH || "config/comfyui-provider.json");
let comfyConfig;
let comfyConfigError;
try {
  comfyConfig = await readJson(comfyConfigPath);
} catch (error) {
  if (error?.code !== "ENOENT") comfyConfigError = String(error?.message || error);
}

let contactWorkflow;
let viewWorkflow;
let handoffWorkflow = defaultHandoffWorkflow;
if (comfyConfig && !comfyConfigError) {
  try {
    contactWorkflow = await loadWorkflowSpec(comfyConfig.contact);
    viewWorkflow = await loadWorkflowSpec(comfyConfig.view);
    handoffWorkflow = await loadWorkflowSpec(comfyConfig.handoff) || defaultHandoffWorkflow;
  } catch (error) {
    comfyConfigError = String(error?.message || error);
  }
}

const comfyProvider = new ComfyUIProvider({
  baseUrl: process.env.COMFYUI_BASE_URL || comfyConfig?.baseUrl || "http://127.0.0.1:8188",
  clientId: comfyConfig?.clientId || "ai-canvas-local",
  contactWorkflow,
  viewWorkflow,
  handoffWorkflow,
});

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 24 * 1024 * 1024,
    files: 10,
  },
  fileFilter(_request, file, callback) {
    if (!file.mimetype.startsWith("image/")) {
      callback(new Error("只支持图像文件。"));
      return;
    }
    callback(null, true);
  },
});

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

function providerFor(id) {
  if (id === "mock") return new MockImageProvider();
  if (id === "comfyui") return comfyProvider;
  if (id === "openai") {
    return new OpenAIImageProvider({
      apiKey: process.env.OPENAI_API_KEY,
      model,
    });
  }
  throw new Error(`未知 Provider: ${id}`);
}

function parseConfig(raw) {
  if (!raw) return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("任务配置格式无效。");
  return value;
}

function asUpload(file) {
  if (!file) throw new Error("请先提供角色参考图。");
  return {
    buffer: file.buffer,
    originalname: file.originalname,
    mimetype: file.mimetype,
  };
}

function safeError(error) {
  const message = String(error?.message || "生成失败，请稍后重试。");
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 500);
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, mode: isDev ? "development" : "production" });
});

app.get("/api/providers", async (_request, response) => {
  let comfyReachable = false;
  let comfyConnectionError;
  try {
    await comfyProvider.health(1200);
    comfyReachable = true;
  } catch (error) {
    comfyConnectionError = String(error?.message || error);
  }
  const comfyGenerate = comfyReachable && comfyProvider.generationConfigured && !comfyConfigError;
  const comfyHandoff = comfyReachable && comfyProvider.handoffConfigured;
  const comfyDetail = comfyConfigError
    ? `配置无效：${safeError(new Error(comfyConfigError))}`
    : !comfyReachable
      ? `未连接本地 ComfyUI：${safeError(new Error(comfyConnectionError))}`
      : !comfyProvider.generationConfigured
        ? "ComfyUI 已连接；八视图交接可用，生成 Provider 仍需配置 API Format 工作流。"
        : "ComfyUI 已连接，生成与八视图交接均可用。";
  response.json({
    providers: [
      {
        id: "mock",
        name: "内置 Mock",
        available: true,
        model: "mock-turntable-v1",
        detail: "不调用外部服务。",
        capabilities: { generate: true, handoff: false },
      },
      {
        id: "comfyui",
        name: "ComfyUI 本地",
        available: comfyGenerate,
        model: contactWorkflow?.label || "API Format workflow",
        detail: comfyDetail,
        capabilities: { generate: comfyGenerate, handoff: comfyHandoff },
      },
      {
        id: "openai",
        name: "GPT Image 2",
        available: hasOpenAI,
        model,
        detail: hasOpenAI ? "服务端环境变量已配置。" : "未配置 OPENAI_API_KEY。",
        capabilities: { generate: hasOpenAI, handoff: false },
      },
    ],
  });
});

app.post("/api/generate-contact-sheet", upload.single("reference"), async (request, response) => {
  try {
    const config = parseConfig(request.body.config);
    const provider = providerFor(config.provider || "mock");
    const result = await provider.generateContactSheet({
      reference: asUpload(request.file),
      prompt: String(config.prompt || ""),
      quality: config.quality || "medium",
      seed: Number(config.seed || 24),
    });
    response.json(result);
  } catch (error) {
    const status = /未配置|不可用|ComfyUI|连接|超时/.test(String(error?.message)) ? 503 : 400;
    response.status(status).json({ error: safeError(error) });
  }
});

const retryUpload = upload.fields([
  { name: "reference", maxCount: 1 },
  { name: "contextSheet", maxCount: 1 },
]);

app.post("/api/generate-view", retryUpload, async (request, response) => {
  try {
    const files = request.files || {};
    const config = parseConfig(request.body.config);
    const provider = providerFor(config.provider || "mock");
    const result = await provider.generateView({
      reference: asUpload(files.reference?.[0]),
      contextSheet: files.contextSheet?.[0] ? asUpload(files.contextSheet[0]) : undefined,
      prompt: String(config.prompt || ""),
      viewId: String(config.viewId || "front"),
      quality: config.quality || "medium",
      seed: Number(config.seed || 24),
    });
    response.json(result);
  } catch (error) {
    const status = /未配置|不可用|ComfyUI|连接|超时/.test(String(error?.message)) ? 503 : 400;
    response.status(status).json({ error: safeError(error) });
  }
});

app.post("/api/comfyui/publish-views", upload.array("views", 8), async (request, response) => {
  try {
    const files = Array.isArray(request.files) ? request.files : [];
    const config = parseConfig(request.body.config);
    const viewIds = Array.isArray(config.viewIds) ? config.viewIds.map(String) : [];
    if (files.length !== 8 || viewIds.length !== 8) {
      throw new Error("ComfyUI 交接需要 8 张图和 8 个视角 ID。");
    }
    const views = files.map((file, index) => ({ ...asUpload(file), id: viewIds[index] }));
    response.json(await comfyProvider.publishViews({ views }));
  } catch (error) {
    const message = String(error?.message || error);
    const status = /ComfyUI|连接|不可用|超时/.test(message) ? 503 : 400;
    response.status(status).json({ error: safeError(error) });
  }
});

if (isDev) {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const dist = path.join(root, "dist");
  app.use(express.static(dist));
  app.use((request, response, next) => {
    if (request.path.startsWith("/api/")) return next();
    response.sendFile(path.join(dist, "index.html"));
  });
}

app.use((error, _request, response, _next) => {
  response.status(400).json({ error: safeError(error) });
});

app.listen(port, host, () => {
  console.log(`AI Canvas running at http://${host}:${port}`);
  console.log(`OpenAI provider: ${hasOpenAI ? `ready (${model})` : "not configured, Mock remains available"}`);
  console.log(`ComfyUI provider: ${comfyProvider.generationConfigured ? "workflow configured" : "handoff only until config/comfyui-provider.json is added"}`);
});
