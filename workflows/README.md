# ComfyUI 工作流契约

AI Canvas 不绑定某个特定模型或自定义节点版本。请先在自己的 ComfyUI 中把工作流跑通，再通过 **Save (API Format)** 导出 JSON，并用 `config/comfyui-provider.json` 把语义输入绑定到实际节点字段。

## 内置八视图交接工作流

`eight-view-loader_api.json` 只使用 ComfyUI 核心的 `LoadImage` 与 `PreviewImage` 节点。界面点击“发送 8 张图到 ComfyUI”后，服务端会：

1. 把八张 PNG 上传到 ComfyUI 的 `input/ai-canvas/<run-id>/`。
2. 将实际文件路径写入八个 `LoadImage` 节点。
3. 通过 `/prompt` 排队运行此工作流。

它是稳定、无模型依赖的交接点。需要 3D 重建、IPAdapter 修图或其他后处理时，可以复制此 API 工作流，继续连接自己的下游节点，再在服务端配置中替换 handoff 工作流。

## 生成工作流

需要准备两份已验证的 API Format JSON：

- 联系表工作流：输入参考图，输出一张 2048 x 1024 的 4 x 2 联系表。
- 单图工作流：输入参考图与可选联系表上下文，输出一张 1024 x 1024 修订图。

复制 `config/comfyui-provider.example.json` 为 `config/comfyui-provider.json`，再把 `workflowApiPath`、`outputNodeIds` 和 `bindings` 改成自己的节点编号与字段路径。

可绑定的语义值包括：

- `positivePrompt`、`negativePrompt`
- `referenceImage`、`contextImage`
- `seed`、`steps`、`width`、`height`
- `viewId`、`outputPrefix`

绑定路径不存在时，Provider 会明确报错，不会静默运行错误的节点图。
