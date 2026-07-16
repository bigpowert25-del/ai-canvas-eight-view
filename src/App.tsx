import { useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  ArrowClockwise,
  Check,
  CheckCircle,
  DownloadSimple,
  FileArrowUp,
  FlowArrow,
  ImageSquare,
  Moon,
  Package,
  Play,
  ShieldCheck,
  Sparkle,
  SquaresFour,
  Sun,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { Button, IconButton, Select, Switch, TextArea, Theme, Tooltip } from "@radix-ui/themes";
import {
  generateContactSheet,
  generateSingleView,
  getProviders,
  publishViewsToComfyUI,
  type ComfyHandoffResponse,
  type ProviderInfo,
} from "./lib/api";
import { exportZip, saveDataUrl } from "./lib/export";
import {
  buildConsistencyReport,
  fileToDataUrl,
  rasterizeToPng,
  splitContactSheet,
  type ConsistencyReport,
} from "./lib/images";
import {
  buildContactSheetPrompt,
  buildSingleViewPrompt,
  createViewTasks,
  DEFAULT_SETTINGS,
  safeAssetName,
  type ProviderId,
  type Quality,
  type ViewTask,
  type WorkspaceSettings,
} from "./lib/views";

interface ReferenceAsset {
  file: File;
  preview: string;
  name: string;
}

interface ContactSheetAsset {
  imageDataUrl: string;
  provider: string;
  model: string;
}

type BusyState = "generate" | "split" | "check" | "comfy" | `retry:${string}` | null;

const CHECK_LABELS: Array<{ key: keyof ConsistencyReport["checks"][number]["checks"]; label: string }> = [
  { key: "square", label: "方形比例" },
  { key: "resolution", label: "导出分辨率" },
  { key: "background", label: "背景稳定" },
  { key: "framing", label: "完整构图" },
  { key: "tone", label: "明暗接近" },
];

function statusLabel(task: ViewTask) {
  if (task.status === "generating") return "生成中";
  if (task.status === "approved") return "已确认";
  if (task.status === "review") return "待复核";
  if (task.status === "error") return "失败";
  if (task.imageDataUrl) return "可检查";
  return "等待切格";
}

function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [settings, setSettings] = useState<WorkspaceSettings>(DEFAULT_SETTINGS);
  const [reference, setReference] = useState<ReferenceAsset>();
  const [contactSheet, setContactSheet] = useState<ContactSheetAsset>();
  const [tasks, setTasks] = useState<ViewTask[]>(createViewTasks);
  const [activeTaskId, setActiveTaskId] = useState("front");
  const [report, setReport] = useState<ConsistencyReport>();
  const [manualChecks, setManualChecks] = useState({ identity: false, outfit: false, proportions: false });
  const [comfyReceipt, setComfyReceipt] = useState<ComfyHandoffResponse>();
  const [busy, setBusy] = useState<BusyState>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string }>();
  const referenceInputRef = useRef<HTMLInputElement>(null);

  async function refreshProviders() {
    try {
      setProviders(await getProviders());
    } catch {
      setProviders([
        { id: "mock", name: "内置 Mock", available: true, model: "mock-turntable-v1", capabilities: { generate: true, handoff: false } },
        { id: "comfyui", name: "ComfyUI 本地", available: false, model: "API Format workflow", detail: "本地服务状态读取失败。", capabilities: { generate: false, handoff: false } },
        { id: "openai", name: "GPT Image 2", available: false, model: "gpt-image-2", capabilities: { generate: false, handoff: false } },
      ]);
    }
  }

  useEffect(() => {
    void refreshProviders();
  }, []);

  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? tasks[0];
  const activeCheck = report?.checks.find((item) => item.id === activeTaskId);
  const selectedProvider = providers.find((provider) => provider.id === settings.provider);
  const comfyProvider = providers.find((provider) => provider.id === "comfyui");
  const comfyHandoffReady = Boolean(comfyProvider?.capabilities?.handoff);
  const completedViews = tasks.filter((task) => task.imageDataUrl).length;
  const approvedViews = tasks.filter((task) => task.status === "approved").length;
  const allManualChecks = Object.values(manualChecks).every(Boolean);
  const promptPreview = useMemo(() => buildContactSheetPrompt(settings, tasks), [settings, tasks]);

  function updateSettings<K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function resetOutputs() {
    setContactSheet(undefined);
    setTasks((current) =>
      createViewTasks().map((task, index) => ({ ...task, instruction: current[index]?.instruction || "" })),
    );
    setReport(undefined);
    setManualChecks({ identity: false, outfit: false, proportions: false });
    setComfyReceipt(undefined);
  }

  async function useReferenceFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setNotice({ tone: "error", text: "请选择 PNG、JPEG、WebP 或 SVG 图像。" });
      return;
    }
    try {
      const source = await fileToDataUrl(file);
      const normalized = await rasterizeToPng(source, "reference.png", 1536);
      setReference({ file: normalized.file, preview: normalized.dataUrl, name: file.name });
      resetOutputs();
      setNotice({ tone: "info", text: "参考图已载入，可以配置八视图任务。" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "参考图读取失败。" });
    }
  }

  async function loadSample() {
    try {
      const response = await fetch("/sample-reference.svg");
      const file = new File([await response.blob()], "sample-character.svg", { type: "image/svg+xml" });
      await useReferenceFile(file);
    } catch {
      setNotice({ tone: "error", text: "内置示例加载失败。" });
    }
  }

  async function applyCut(sheet = contactSheet) {
    if (!sheet) return;
    setBusy("split");
    try {
      const images = await splitContactSheet(sheet.imageDataUrl, settings.trimPercent);
      setTasks((current) =>
        current.map((task, index) => ({
          ...task,
          imageDataUrl: images[index],
          status: "ready",
          provider: sheet.provider,
          model: sheet.model,
        })),
      );
      setReport(undefined);
      setNotice({ tone: "info", text: "联系表已按 4 x 2 网格切成 8 张 PNG。" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "自动切格失败。" });
    } finally {
      setBusy(null);
    }
  }

  async function runGeneration() {
    if (!reference) {
      setNotice({ tone: "error", text: "请先上传角色参考图，或加载内置示例。" });
      referenceInputRef.current?.focus();
      return;
    }
    if (!selectedProvider?.available) {
      setNotice({ tone: "error", text: selectedProvider?.detail || "当前生成 Provider 尚未配置。" });
      return;
    }
    setBusy("generate");
    setTasks((current) => current.map((task) => ({ ...task, status: "generating" })));
    setNotice({ tone: "info", text: "正在生成八视图联系表。真实模型可能需要约两分钟。" });
    try {
      const result = await generateContactSheet({
        reference: reference.file,
        provider: settings.provider,
        prompt: promptPreview,
        quality: settings.quality,
        seed: settings.seed,
      });
      const nextSheet = result;
      setContactSheet(nextSheet);
      const images = await splitContactSheet(nextSheet.imageDataUrl, settings.trimPercent);
      setTasks((current) =>
        current.map((task, index) => ({
          ...task,
          imageDataUrl: images[index],
          status: "ready",
          provider: result.provider,
          model: result.model,
          revision: task.revision + 1,
        })),
      );
      setReport(undefined);
      setManualChecks({ identity: false, outfit: false, proportions: false });
      setNotice({ tone: "info", text: "联系表已生成并自动切格。请检查八张单图。" });
    } catch (error) {
      setTasks((current) => current.map((task) => ({ ...task, status: "error" })));
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "生成失败。" });
    } finally {
      setBusy(null);
    }
  }

  async function retryView(task: ViewTask) {
    if (!reference) return;
    const state: BusyState = `retry:${task.id}`;
    setBusy(state);
    setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, status: "generating" } : item)));
    try {
      const context = contactSheet
        ? await rasterizeToPng(contactSheet.imageDataUrl, "contact-sheet.png", 2048)
        : undefined;
      const result = await generateSingleView({
        reference: reference.file,
        contextSheet: context?.file,
        provider: settings.provider,
        viewId: task.id,
        prompt: buildSingleViewPrompt(settings, task, Boolean(context)),
        quality: settings.quality,
        seed: settings.seed,
      });
      const png = await rasterizeToPng(result.imageDataUrl, `${task.id}.png`, 1024);
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? {
                ...item,
                imageDataUrl: png.dataUrl,
                status: "ready",
                revision: item.revision + 1,
                provider: result.provider,
                model: result.model,
              }
            : item,
        ),
      );
      setReport(undefined);
      setNotice({ tone: "info", text: `${task.name}已重试，只替换了这一张图。` });
    } catch (error) {
      setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, status: "error" } : item)));
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "单图重试失败。" });
    } finally {
      setBusy(null);
    }
  }

  async function replaceView(task: ViewTask, file?: File) {
    if (!file) return;
    try {
      const source = await fileToDataUrl(file);
      const png = await rasterizeToPng(source, `${task.id}.png`, 1024);
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? { ...item, imageDataUrl: png.dataUrl, status: "ready", revision: item.revision + 1, provider: "manual" }
            : item,
        ),
      );
      setReport(undefined);
      setNotice({ tone: "info", text: `${task.name}已替换并标准化为 PNG。` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "替换图读取失败。" });
    }
  }

  async function runConsistencyCheck() {
    if (completedViews !== 8) {
      setNotice({ tone: "error", text: "需要 8 张单图才能运行完整检查。" });
      return;
    }
    setBusy("check");
    try {
      const nextReport = await buildConsistencyReport(tasks);
      setReport(nextReport);
      setTasks((current) =>
        current.map((task) => {
          if (task.status === "approved") return task;
          const view = nextReport.checks.find((item) => item.id === task.id);
          return { ...task, status: view?.score === 100 ? "ready" : "review" };
        }),
      );
      setNotice({ tone: "info", text: `自动检查完成，技术一致性得分 ${nextReport.score}。身份与服装仍需人工确认。` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "一致性检查失败。" });
    } finally {
      setBusy(null);
    }
  }

  function toggleApprove(task: ViewTask) {
    if (!task.imageDataUrl) return;
    setTasks((current) =>
      current.map((item) =>
        item.id === task.id ? { ...item, status: item.status === "approved" ? "ready" : "approved" } : item,
      ),
    );
  }

  async function runExport() {
    if (completedViews !== 8) {
      setNotice({ tone: "error", text: "导出 ZIP 前需要准备好全部 8 张视图。" });
      return;
    }
    await exportZip({
      tasks,
      settings,
      referenceName: reference?.name || "reference.png",
      providerModel: contactSheet?.model,
      report,
    });
    setNotice({ tone: "info", text: "ZIP 已生成，包含 8 张 PNG、清单和检查报告。" });
  }

  async function runComfyHandoff() {
    if (completedViews !== 8) {
      setNotice({ tone: "error", text: "发送到 ComfyUI 前需要准备好全部 8 张视图。" });
      return;
    }
    if (!comfyHandoffReady) {
      setNotice({ tone: "error", text: comfyProvider?.detail || "本地 ComfyUI 尚未连接。" });
      return;
    }
    setBusy("comfy");
    try {
      const result = await publishViewsToComfyUI(
        tasks.map((task, index) => ({
          id: task.id,
          filename: safeAssetName(index, task),
          imageDataUrl: task.imageDataUrl!,
        })),
      );
      setComfyReceipt(result);
      setNotice({ tone: "info", text: `8 张 PNG 已上传并进入 ComfyUI 队列，任务 ${result.promptId.slice(0, 8)}。` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "ComfyUI 交接失败。" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Theme appearance={theme} accentColor="orange" grayColor="slate" radius="medium" scaling="95%">
      <div className="app-root" data-theme={theme}>
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true"><Aperture size={22} weight="duotone" /></div>
            <div>
              <strong>AI Canvas</strong>
              <span>角色八视图工作台</span>
            </div>
          </div>
          <div className="topbar-actions">
            <div className={`provider-state ${selectedProvider?.available ? "is-ready" : "is-offline"}`}>
              {selectedProvider?.available ? <CheckCircle size={16} weight="fill" /> : <WarningCircle size={16} weight="fill" />}
              <span>{selectedProvider?.name || "Provider 检查中"}</span>
            </div>
            <Tooltip content={theme === "dark" ? "切换浅色" : "切换深色"}>
              <IconButton variant="soft" aria-label={theme === "dark" ? "切换浅色" : "切换深色"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </IconButton>
            </Tooltip>
            <Button variant="solid" className="export-button" onClick={runExport} disabled={completedViews !== 8}>
              <Package size={17} /> 导出 ZIP
            </Button>
          </div>
        </header>

        <div className="stage-strip" aria-label="工作流进度">
          {[
            { label: "参考图", done: Boolean(reference) },
            { label: "联系表", done: Boolean(contactSheet) },
            { label: "8 张切格", done: completedViews === 8 },
            { label: "一致性检查", done: Boolean(report) },
            { label: "人工确认", done: approvedViews === 8 && allManualChecks },
            { label: "ComfyUI 交接", done: Boolean(comfyReceipt) },
          ].map((stage) => (
            <div className={stage.done ? "stage-item is-done" : "stage-item"} key={stage.label}>
              <span>{stage.done ? <Check size={12} weight="bold" /> : null}</span>
              {stage.label}
            </div>
          ))}
        </div>

        <main className="workspace-shell">
          <aside className="setup-panel" aria-label="生成设置">
            <section className="panel-section">
              <div className="section-heading">
                <h2>角色参考</h2>
                {reference ? <button className="text-button" onClick={() => { setReference(undefined); resetOutputs(); }}><X size={14} /> 清除</button> : null}
              </div>
              <input
                ref={referenceInputRef}
                className="visually-hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void useReferenceFile(file);
                  event.currentTarget.value = "";
                }}
              />
              <button
                className={`reference-drop ${reference ? "has-image" : ""}`}
                onClick={() => referenceInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files?.[0];
                  if (file) void useReferenceFile(file);
                }}
              >
                {reference ? (
                  <>
                    <img src={reference.preview} alt="当前角色参考图" />
                    <span className="reference-caption"><UploadSimple size={15} /> 更换参考图</span>
                  </>
                ) : (
                  <span className="drop-copy">
                    <FileArrowUp size={28} weight="duotone" />
                    <strong>拖入角色全身图</strong>
                    <small>PNG、JPEG、WebP 或 SVG，建议正面站姿</small>
                  </span>
                )}
              </button>
              {!reference ? (
                <Button variant="soft" className="full-button" onClick={loadSample}>
                  <Sparkle size={17} /> 加载内置示例
                </Button>
              ) : <p className="file-name" title={reference.name}>{reference.name}</p>}
            </section>

            <section className="panel-section settings-section">
              <h2>生成设置</h2>
              <label className="field-label">
                <span>图像 Provider</span>
                <Select.Root value={settings.provider} onValueChange={(value) => updateSettings("provider", value as ProviderId)}>
                  <Select.Trigger className="select-trigger" />
                  <Select.Content>
                    {providers.map((provider) => (
                      <Select.Item value={provider.id} key={provider.id} disabled={!provider.available}>
                        {provider.name}{provider.available ? "" : "（未配置）"}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>
              <div className="two-fields">
                <label className="field-label">
                  <span>质量</span>
                  <Select.Root value={settings.quality} onValueChange={(value) => updateSettings("quality", value as Quality)}>
                    <Select.Trigger />
                    <Select.Content>
                      <Select.Item value="low">草稿</Select.Item>
                      <Select.Item value="medium">标准</Select.Item>
                      <Select.Item value="high">高质量</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </label>
                <label className="field-label">
                <span>生成种子</span>
                  <input type="number" min="1" max="999" value={settings.seed} onChange={(event) => updateSettings("seed", Number(event.target.value || 1))} />
                </label>
              </div>
              <label className="field-label">
                <span>视觉风格</span>
                <TextArea value={settings.style} resize="vertical" onChange={(event) => updateSettings("style", event.target.value)} />
              </label>
              <label className="field-label">
                <span>角色锁定规则</span>
                <TextArea value={settings.characterLock} resize="vertical" onChange={(event) => updateSettings("characterLock", event.target.value)} />
              </label>
              <details className="advanced-settings">
                <summary>更多约束</summary>
                <label className="field-label">
                  <span>背景</span>
                  <TextArea value={settings.background} resize="vertical" onChange={(event) => updateSettings("background", event.target.value)} />
                </label>
                <label className="field-label">
                  <span>排除项</span>
                  <TextArea value={settings.negativeConstraints} resize="vertical" onChange={(event) => updateSettings("negativeConstraints", event.target.value)} />
                </label>
              </details>
              <Button size="3" className="generate-button" onClick={runGeneration} disabled={Boolean(busy)}>
                {busy === "generate" ? <ArrowClockwise className="spin" size={18} /> : <Play size={18} weight="fill" />}
                {busy === "generate" ? "正在生成" : "生成联系表"}
              </Button>
              <p className="provider-note">
                {settings.provider === "mock"
                  ? "Mock 不调用外部服务，可完整体验切格、重试、检查和导出。"
                  : settings.provider === "comfyui"
                    ? "使用服务端加载的 API Format 工作流；前端不能指定任意地址或文件路径。"
                    : "密钥仅由本地服务端环境变量读取，不会进入浏览器。"}
              </p>
            </section>
          </aside>

          <section className="canvas-panel" aria-label="联系表和单图预览">
            <div className="canvas-toolbar">
              <div>
                <span className="toolbar-kicker">联系表预览</span>
                <h1>一张参考图，八个可交付视角</h1>
              </div>
              <div className="toolbar-actions">
                <label className="trim-control">
                  <span>切格内缩 {settings.trimPercent}%</span>
                  <input type="range" min="0" max="6" step="0.5" value={settings.trimPercent} onChange={(event) => updateSettings("trimPercent", Number(event.target.value))} />
                </label>
                <Button variant="soft" onClick={() => void applyCut()} disabled={!contactSheet || Boolean(busy)}>
                  {busy === "split" ? <ArrowClockwise className="spin" size={16} /> : <SquaresFour size={16} />}
                  自动切格
                </Button>
              </div>
            </div>

            <div className={`contact-sheet-frame ${contactSheet ? "has-sheet" : "is-empty"}`}>
              {contactSheet ? (
                <>
                  <img src={contactSheet.imageDataUrl} alt="当前八视图联系表" />
                  <div className="grid-guides" aria-hidden="true">
                    {tasks.map((task) => <span key={task.id} />)}
                  </div>
                </>
              ) : (
                <div className="empty-contact">
                  <ImageSquare size={42} weight="duotone" />
                  <strong>联系表将在这里出现</strong>
                  <p>上传参考图后使用 Mock 即可离线走完整流程。</p>
                  {!reference ? <Button variant="soft" onClick={loadSample}><Sparkle size={16} /> 使用示例开始</Button> : null}
                </div>
              )}
            </div>
            <div className="view-order" aria-label="联系表视角顺序">
              {tasks.map((task) => <span key={task.id}><b>{task.angle}</b>{task.name}</span>)}
            </div>

            <div className="asset-heading">
              <div>
                <span className="toolbar-kicker">切格结果</span>
                <h2>8 张独立 PNG</h2>
              </div>
              <span>{completedViews}/8 已准备</span>
            </div>

            <div className="view-grid">
              {tasks.map((task, index) => {
                const retrying = busy === `retry:${task.id}`;
                return (
                  <article className={`view-card ${activeTaskId === task.id ? "is-active" : ""}`} key={task.id} onClick={() => setActiveTaskId(task.id)}>
                    <header>
                      <div><strong>{task.name}</strong><span>{task.angle}</span></div>
                      <span className={`task-status status-${task.status}`}>{statusLabel(task)}</span>
                    </header>
                    <div className="view-image">
                      {task.imageDataUrl ? <img src={task.imageDataUrl} alt={`${task.name}角色视图`} /> : (
                        <div className="view-placeholder">{task.status === "generating" ? <ArrowClockwise className="spin" size={24} /> : <Aperture size={26} />}</div>
                      )}
                    </div>
                    <footer>
                      <Tooltip content="重新生成这一张">
                        <IconButton variant="soft" aria-label={`重试${task.name}`} disabled={!reference || Boolean(busy)} onClick={(event) => { event.stopPropagation(); void retryView(task); }}>
                          <ArrowClockwise className={retrying ? "spin" : ""} size={16} />
                        </IconButton>
                      </Tooltip>
                      <label className="icon-upload" onClick={(event) => event.stopPropagation()}>
                        <input type="file" accept="image/*" onChange={(event) => { void replaceView(task, event.target.files?.[0]); event.currentTarget.value = ""; }} />
                        <UploadSimple size={16} /><span className="visually-hidden">替换{task.name}</span>
                      </label>
                      <Tooltip content="下载 PNG">
                        <IconButton variant="soft" aria-label={`下载${task.name}`} disabled={!task.imageDataUrl} onClick={(event) => { event.stopPropagation(); if (task.imageDataUrl) void saveDataUrl(task.imageDataUrl, safeAssetName(index, task)); }}>
                          <DownloadSimple size={16} />
                        </IconButton>
                      </Tooltip>
                      <button className={task.status === "approved" ? "approve-button is-approved" : "approve-button"} disabled={!task.imageDataUrl} onClick={(event) => { event.stopPropagation(); toggleApprove(task); }}>
                        <Check size={14} weight="bold" /> {task.status === "approved" ? "已确认" : "确认"}
                      </button>
                    </footer>
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="review-panel" aria-label="任务配置和一致性检查">
            <section className="panel-section task-config">
              <div className="section-heading">
                <h2>八视图任务</h2>
                <span>{activeTask.angle}</span>
              </div>
              <div className="task-selector" role="list" aria-label="选择视图任务">
                {tasks.map((task) => (
                  <button key={task.id} className={activeTaskId === task.id ? "is-active" : ""} onClick={() => setActiveTaskId(task.id)}>
                    <span>{task.name}</span><small>{task.angle}</small>
                  </button>
                ))}
              </div>
              <label className="field-label task-instruction">
                <span>{activeTask.name}补充约束</span>
                <TextArea
                  placeholder="例如：右手手套上的徽章必须完整可见"
                  value={activeTask.instruction}
                  resize="vertical"
                  onChange={(event) => {
                    const value = event.target.value;
                    setTasks((current) => current.map((task) => task.id === activeTask.id ? { ...task, instruction: value } : task));
                  }}
                />
              </label>
            </section>

            <section className="panel-section consistency-panel">
              <div className="section-heading">
                <div>
                  <h2>一致性检查</h2>
                  <p>自动检查构图和图像属性</p>
                </div>
                <div className={`score-ring ${report && report.score >= 80 ? "is-good" : ""}`}>
                  <strong>{report?.score ?? "-"}</strong><span>/100</span>
                </div>
              </div>
              <Button variant="soft" className="full-button" disabled={completedViews !== 8 || Boolean(busy)} onClick={runConsistencyCheck}>
                {busy === "check" ? <ArrowClockwise className="spin" size={17} /> : <ShieldCheck size={17} />}
                运行自动检查
              </Button>
              <div className="check-results">
                {CHECK_LABELS.map((check) => {
                  const passed = activeCheck?.checks[check.key];
                  return (
                    <div key={check.key}>
                      <span className={passed ? "check-icon pass" : activeCheck ? "check-icon fail" : "check-icon"}>
                        {passed ? <Check size={12} weight="bold" /> : activeCheck ? <X size={12} weight="bold" /> : null}
                      </span>
                      <span>{check.label}</span>
                    </div>
                  );
                })}
              </div>
              {activeCheck ? <p className="active-score">{activeTask.name}技术得分：{activeCheck.score}</p> : null}
              <div className="manual-review">
                <h3>人工复核</h3>
                <p>身份、服装细节和几何关系不能只靠像素统计。</p>
                {[
                  { key: "identity", label: "脸部与身份一致" },
                  { key: "outfit", label: "服装与配件一致" },
                  { key: "proportions", label: "身体比例与轮廓一致" },
                ].map((item) => (
                  <label key={item.key}>
                    <span>{item.label}</span>
                    <Switch checked={manualChecks[item.key as keyof typeof manualChecks]} onCheckedChange={(checked) => setManualChecks((current) => ({ ...current, [item.key]: checked }))} />
                  </label>
                ))}
              </div>
              <div className="review-summary">
                <Aperture size={18} />
                <div><strong>{approvedViews}/8 单图已确认</strong><span>{allManualChecks ? "人工复核已完成" : "还需完成人工复核"}</span></div>
              </div>
              <div className="comfy-handoff">
                <div className="handoff-heading">
                  <div>
                    <strong>ComfyUI 工作流</strong>
                    <span className={comfyHandoffReady ? "handoff-state is-ready" : "handoff-state"}>
                      {comfyHandoffReady ? "本地服务已连接" : "等待本地服务"}
                    </span>
                  </div>
                  <button className="text-button" onClick={() => void refreshProviders()} disabled={Boolean(busy)}>
                    <ArrowClockwise size={13} /> 重检
                  </button>
                </div>
                <p>{comfyReceipt ? `已排队：${comfyReceipt.promptId}` : comfyProvider?.detail || "启动 ComfyUI 后可上传八张视图并运行加载工作流。"}</p>
                <Button
                  variant="soft"
                  className="full-button"
                  disabled={completedViews !== 8 || !comfyHandoffReady || Boolean(busy)}
                  onClick={() => void runComfyHandoff()}
                >
                  {busy === "comfy" ? <ArrowClockwise className="spin" size={17} /> : <FlowArrow size={17} />}
                  {busy === "comfy" ? "正在交接" : "发送 8 张图到 ComfyUI"}
                </Button>
              </div>
            </section>
          </aside>
        </main>

        {notice ? (
          <div className={`notice notice-${notice.tone}`} role="status" aria-live="polite">
            {notice.tone === "error" ? <WarningCircle size={19} weight="fill" /> : <CheckCircle size={19} weight="fill" />}
            <span>{notice.text}</span>
            <button aria-label="关闭提示" onClick={() => setNotice(undefined)}><X size={15} /></button>
          </div>
        ) : null}
      </div>
    </Theme>
  );
}

export default App;
