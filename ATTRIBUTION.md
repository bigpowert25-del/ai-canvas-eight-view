# 来源、借鉴与第三方说明

最后核验：2026-07-16。

本文件把产品灵感、外部接口、第三方依赖和本仓库原创实现分开说明。链接到外部项目不代表对方为本项目背书。

## 产品流程灵感

| 来源 | 借鉴内容 | 仓库中是否包含来源内容 |
|---|---|---|
| [抖音视频 7662431494996004130](https://www.douyin.com/video/7662431494996004130) | “参考图 → 多视图联系表 → 切格 → 一致性检查 → 导出”的可观察工作流 | 否。仅保留来源链接；未复制视频画面、音频、字幕、品牌资产、页面代码或作者未公开源码 |
| [Tencent Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) | 早期研究中作为八视图之后可选的 3D 重建方向 | 否。当前仓库没有集成 Hunyuan3D、模型权重或其源码 |

## 外部接口与服务

- [ComfyUI Server Routes](https://docs.comfy.org/development/comfyui-server/comms_routes) 与[官方 API 示例](https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/websockets_api_example.py)用于核对 HTTP 接口契约。本仓库的 Provider、节点绑定、轮询和错误处理为本地实现；没有打包 ComfyUI 上游源码、模型或自定义节点。
- [OpenAI 图像生成与编辑 API](https://developers.openai.com/api/docs/guides/image-generation)用于可选的 GPT Image 适配器。仓库不包含 OpenAI 模型、服务实现或密钥，真实调用由使用者自己的 API 配置产生。
- `workflows/eight-view-loader_api.json` 是面向 ComfyUI 核心 `LoadImage` / `PreviewImage` 节点制作的本地工作流，不是从第三方成品工作流仓库复制的模型管线。

## 主要直接依赖

完整版本与传递依赖见 `pnpm-lock.yaml`。

| 软件 | 用途 | 许可证 |
|---|---|---|
| React、Express、Radix Themes、Phosphor Icons、Multer、Vite、Vitest | UI、本地服务、图标、上传、构建与测试 | MIT |
| OpenAI JavaScript SDK | 可选图像 API 客户端 | Apache-2.0 |
| JSZip | 浏览器端 ZIP 导出 | MIT OR GPL-3.0-or-later |

第三方包继续受各自许可证约束；本仓库的 MIT License 不会覆盖或重新许可这些包。

## 本仓库原创实现

- 八视图任务状态、提示词编排和人工确认流程；
- 联系表自动切格、PNG 标准化、一致性检查和 ZIP 清单；
- Mock、OpenAI 与 ComfyUI Provider 适配层；
- 八图上传、节点注入、队列轮询、结果取回与错误边界；
- React 工作台、测试、配置模板和合成示例 SVG。

## 明确未包含

- 抖音视频文件、截图、音频、字幕或创作者品牌素材；
- ComfyUI、Hunyuan3D 或其他上游项目的源码和模型权重；
- OpenAI 服务端代码、模型或任何用户密钥；
- 未经确认的第三方角色图片或训练数据。
