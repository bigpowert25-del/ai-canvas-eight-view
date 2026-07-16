# AI Canvas 角色八视图工作台

一个可本地运行的角色资产 MVP。输入一张角色参考图，配置八个环绕视角，生成 4 x 2 联系表，自动切成 8 张 PNG，再逐张替换、重试、检查并导出 ZIP。

默认使用内置 Mock Provider，不需要密钥，也不会调用外部服务。项目同时提供真实 GPT Image 2 与本地 ComfyUI 服务端适配器，但不会索取、保存或在前端暴露密钥。

## 已实现

- 参考图上传、拖放和内置示例
- 正面、背面、左右侧、四个 45 度视角任务配置
- 4 x 2 联系表生成与网格预览
- 自动切格、0-6% 切格内缩和 1024 x 1024 PNG 标准化
- 单图 Mock/GPT Image 2 重试
- 单图本地替换、确认和 PNG 下载
- 尺寸、比例、背景、构图、明暗的自动一致性检查
- 身份、服装、身体比例的人工复核界面
- 8 张 PNG、`manifest.json` 和 `consistency-report.json` 的 ZIP 导出
- ComfyUI API Format 生成 Provider：上传、节点注入、排队、轮询和输出取回
- 八张 PNG 一键上传到 ComfyUI，并运行内置八视图 Loader 工作流
- 浅色/深色界面和移动端布局

## 快速运行

要求 Node.js 20.19 或更高版本。

```bash
corepack enable
pnpm install
pnpm dev
```

浏览器打开：<http://127.0.0.1:4173>

无需配置任何密钥。点击“加载内置示例”，保持“内置 Mock”，再点击“生成联系表”即可走完整流程。

## 生产构建

```bash
pnpm build
pnpm start
```

`pnpm start` 会由同一个本地 Node 服务提供构建产物和 API。

## 合并进 ComfyUI 工作流

项目提供两层集成，互不依赖：

### 1. 把八张成品图交给 ComfyUI

这层不需要模型配置。先启动本地 ComfyUI（默认 `http://127.0.0.1:8188`），在 AI Canvas 中准备好 8 张图，然后在右侧“ComfyUI 工作流”区域点击“重检”和“发送 8 张图到 ComfyUI”。

服务端会把图像上传到 ComfyUI 的 input 目录，按 `front → front-right → right → back-right → back → back-left → left → front-left` 命名，再排队运行 [`workflows/eight-view-loader_api.json`](./workflows/eight-view-loader_api.json)。内置 Loader 只使用核心 `LoadImage` / `PreviewImage` 节点，没有模型与自定义节点依赖，可作为 3D 重建、IPAdapter 修图或其他下游流程的接入点。

### 2. 直接用 ComfyUI 生成联系表和单图

1. 在自己的 ComfyUI 中分别跑通“联系表”和“单图修复”两份工作流。
2. 从 ComfyUI 导出 **API Format** JSON，保存到本项目 `workflows/`。
3. 复制配置模板：

   ```bash
   cp config/comfyui-provider.example.json config/comfyui-provider.json
   ```

4. 修改两处 `workflowApiPath`，并按实际工作流修改 `bindings` 与 `outputNodeIds`。
5. 重启 AI Canvas，点击“重检”。当 ComfyUI 可连接且两份工作流都有效时，“ComfyUI 本地”会成为可选生成 Provider。

支持注入 `positivePrompt`、`negativePrompt`、`referenceImage`、`contextImage`、`seed`、`steps`、`width`、`height`、`viewId` 与 `outputPrefix`。绑定路径失效会直接报错，避免节点图变化后静默生成错误结果。详细契约见 [`workflows/README.md`](./workflows/README.md)。

可选环境变量：

```dotenv
COMFYUI_BASE_URL=http://127.0.0.1:8188
COMFYUI_CONFIG_PATH=config/comfyui-provider.json
```

安全边界：ComfyUI 地址和工作流路径只由本地服务端配置读取，浏览器不能动态指定任意地址或文件；工作流文件必须位于 `03-ai-canvas` 项目目录内。项目不会替你下载模型或自定义节点，也不会把任何密钥写入仓库。

集成遵循 ComfyUI 官方核心接口：`/system_stats`、`/upload/image`、`/prompt`、`/history/{prompt_id}` 与 `/view`。

- [ComfyUI Server Routes](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [ComfyUI 官方 WebSocket/API 示例](https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/websockets_api_example.py)

## 接入 GPT Image 2

1. 复制环境变量模板：

   ```bash
   cp .env.example .env
   ```

2. 在本机 `.env` 中设置 `OPENAI_API_KEY`。不要提交 `.env`。
3. 运行 `npm run dev`。
4. 在界面中选择“GPT Image 2”。

适配器位于 `server/providers/openai-provider.mjs`。它使用服务端 OpenAI SDK 调用 `images.edit`：

- 联系表使用参考图作为高保真输入，输出 `2048x1024` PNG。
- 单图重试使用参考图，并在可用时附带当前联系表作为第二张上下文图。
- 模型默认为 `gpt-image-2`，可通过 `OPENAI_IMAGE_MODEL` 修改。
- `gpt-image-2` 自动高保真处理图像输入，因此适配器不传 `input_fidelity`。

官方参考：

- [GPT Image 2 模型说明](https://developers.openai.com/api/docs/models/gpt-image-2)
- [图像生成与编辑指南](https://developers.openai.com/api/docs/guides/image-generation)

## 使用流程

1. 上传完整角色参考图，或加载内置示例。
2. 选择 Provider、质量，并调整风格和角色锁定规则。
3. 在右侧选择某个视角，为它添加单独约束。
4. 生成联系表。生成完成后会自动切格。
5. 调整“切格内缩”并重新自动切格，直到边界干净。
6. 对问题视图使用重试，或上传本地修订图替换。
7. 运行自动检查，再逐张确认身份、服装和比例。
8. 导出 ZIP，或把八张成品图发送到本地 ComfyUI 工作流。

## 自动检查的边界

自动检查只分析方形比例、分辨率、背景变化、主体边距和整体明暗。它不能可靠判断人物身份、服装细节或三维几何是否一致，所以界面把这三项保留为明确的人工复核步骤。

真实图像模型也可能在重复角色、配件位置和背面结构上出现漂移。用于 3D 重建前，仍应人工挑选，并根据目标管线进一步送入真正的多视图 3D 模型。

## 验证命令

```bash
pnpm test
pnpm build
```

测试覆盖八视图顺序、提示词编排、导出文件名、Mock Provider，以及 ComfyUI 节点绑定、上传、排队、轮询、取图和八视图交接。

## 本次交付验证结果

验证日期：2026-07-15。

- `pnpm test`：3 个测试文件、10 个测试全部通过。
- `pnpm build`：TypeScript 编译和 Vite 生产构建通过。
- 生产 API：`/api/health`、`/api/providers` 和 Mock 联系表生成请求通过。
- Mock API 返回 `mock-turntable-v1`，联系表为有效的内嵌 SVG 图像数据。
- ComfyUI 交接端到端验证：模拟官方本地路由后，状态切换为 `handoff: true`，8 张图全部上传，Loader 节点绑定通过并返回 `prompt_id`。
- ComfyUI 未启动时，交接 API 返回明确的 503 与本地连接错误，不影响 Mock 主流程。
- 浏览器完整流程：加载示例、生成联系表、自动切格、100 分自动检查、单图重试、任务约束保存和 ZIP 生成均通过。
- 视觉检查：桌面浅色、桌面深色和 390 x 844 小屏布局通过；小屏保留 ZIP 导出入口。
- 浏览器控制台：0 条 error/warning。

当前环境未配置图像模型凭据，因此没有发起真实 GPT Image 2 计费请求。真实适配器已依据 OpenAI 官方图像编辑接口和本项目安装的 OpenAI SDK 6.47.0 参数定义完成核对。

当前环境也没有运行 `127.0.0.1:8188` 的 ComfyUI 实例，因此真实 ComfyUI 推理未执行；适配器通过模拟官方 HTTP 路由的自动测试完成验证，Mock 仍可独立运行完整 MVP。

## 许可证

本项目原创代码采用 [MIT License](./LICENSE)。OpenAI SDK、ComfyUI、React、Radix UI 及其他依赖保留各自许可证；仓库不包含模型权重或 ComfyUI 上游源码。

## 目录

```text
src/
  App.tsx                 工作台界面和完整交互状态
  lib/api.ts              浏览器到本地服务端的 API 调用
  lib/images.ts           自动切格、PNG 标准化和一致性检查
  lib/export.ts           PNG 与 ZIP 导出
  lib/views.ts            八视图定义和提示词编排
server/
  index.mjs               本地 API 与静态资源服务
  providers/
    comfyui-provider.mjs  ComfyUI 上传、注入、排队、轮询与交接适配器
    mock-provider.mjs     无凭据可用的确定性 Mock
    openai-provider.mjs   GPT Image 2 真实适配器
config/
  comfyui-provider.example.json  API 工作流节点绑定模板
workflows/
  eight-view-loader_api.json     无模型依赖的八视图交接工作流
public/
  sample-reference.svg    内置示例参考图
```
