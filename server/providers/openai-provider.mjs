import OpenAI, { toFile } from "openai";

function imageDataUrl(base64, format = "png") {
  return `data:image/${format};base64,${base64}`;
}

function requireImage(result) {
  const base64 = result.data?.[0]?.b64_json;
  if (!base64) {
    throw new Error("OpenAI 返回中没有可用图像数据。");
  }
  return base64;
}

async function uploadedToFile(image) {
  return toFile(image.buffer, image.originalname || "reference.png", {
    type: image.mimetype || "image/png",
  });
}

export class OpenAIImageProvider {
  id = "openai";

  constructor({ apiKey, model = "gpt-image-2" }) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY 未配置。");
    }
    this.model = model;
    this.client = new OpenAI({ apiKey });
  }

  async generateContactSheet({ reference, prompt, quality = "medium" }) {
    const result = await this.client.images.edit({
      model: this.model,
      image: await uploadedToFile(reference),
      prompt,
      size: "2048x1024",
      quality,
      output_format: "png",
    });

    return {
      imageDataUrl: imageDataUrl(requireImage(result)),
      provider: this.id,
      model: this.model,
    };
  }

  async generateView({ reference, contextSheet, prompt, quality = "medium" }) {
    const images = [await uploadedToFile(reference)];
    if (contextSheet) {
      images.push(await uploadedToFile(contextSheet));
    }

    const result = await this.client.images.edit({
      model: this.model,
      image: images,
      prompt,
      size: "1024x1024",
      quality,
      output_format: "png",
    });

    return {
      imageDataUrl: imageDataUrl(requireImage(result)),
      provider: this.id,
      model: this.model,
    };
  }
}
