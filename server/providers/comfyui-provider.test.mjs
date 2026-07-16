import { describe, expect, it } from "vitest";
import { ComfyUIProvider, compileComfyPrompt } from "./comfyui-provider.mjs";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function image(name = "reference.png") {
  return {
    buffer: Buffer.from("png-data"),
    originalname: name,
    mimetype: "image/png",
  };
}

describe("compileComfyPrompt", () => {
  it("injects semantic values without mutating the exported API workflow", () => {
    const workflowApi = {
      "1": { class_type: "TextNode", inputs: { text: "before", seed: 0 } },
      "2": { class_type: "LoadImage", inputs: { image: "" } },
    };
    const compiled = compileComfyPrompt({
      workflowApi,
      bindings: {
        positivePrompt: ["1.inputs.text"],
        seed: ["1.inputs.seed"],
        referenceImage: ["2.inputs.image"],
      },
      values: { positivePrompt: "same character", seed: 42, referenceImage: "ai-canvas/reference.png" },
    });
    expect(compiled["1"].inputs).toEqual({ text: "same character", seed: 42 });
    expect(compiled["2"].inputs.image).toBe("ai-canvas/reference.png");
    expect(workflowApi["1"].inputs.text).toBe("before");
  });

  it("fails loudly when a configured node binding no longer exists", () => {
    expect(() => compileComfyPrompt({
      workflowApi: { "1": { inputs: { text: "" } } },
      bindings: { positivePrompt: ["99.inputs.text"] },
      values: { positivePrompt: "test" },
    })).toThrow(/binding path/);
  });
});

describe("ComfyUIProvider", () => {
  it("uploads, queues, polls and downloads a contact sheet", async () => {
    const queuedBodies = [];
    let historyCalls = 0;
    const fetchFn = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/upload/image") {
        return jsonResponse({ name: "reference.png", subfolder: "ai-canvas/run", type: "input" });
      }
      if (url.pathname === "/prompt") {
        queuedBodies.push(JSON.parse(init.body));
        return jsonResponse({ prompt_id: "prompt-1", number: 1 });
      }
      if (url.pathname === "/history/prompt-1") {
        historyCalls += 1;
        if (historyCalls === 1) return jsonResponse({});
        return jsonResponse({
          "prompt-1": {
            status: { completed: true },
            outputs: { "9": { images: [{ filename: "sheet.png", subfolder: "", type: "output" }] } },
          },
        });
      }
      if (url.pathname === "/view") {
        return new Response(Buffer.from("rendered-png"), { status: 200, headers: { "content-type": "image/png" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const workflow = {
      workflowApi: {
        "3": { class_type: "Sampler", inputs: { seed: 0, steps: 0 } },
        "6": { class_type: "Text", inputs: { text: "" } },
        "9": { class_type: "SaveImage", inputs: { filename_prefix: "", images: ["8", 0] } },
        "10": { class_type: "LoadImage", inputs: { image: "" } },
      },
      bindings: {
        positivePrompt: ["6.inputs.text"],
        referenceImage: ["10.inputs.image"],
        seed: ["3.inputs.seed"],
        steps: ["3.inputs.steps"],
        outputPrefix: ["9.inputs.filename_prefix"],
      },
      outputNodeIds: ["9"],
      label: "test contact workflow",
    };
    const provider = new ComfyUIProvider({
      baseUrl: "http://127.0.0.1:8188",
      contactWorkflow: workflow,
      viewWorkflow: workflow,
      handoffWorkflow: workflow,
      fetchFn,
      sleepFn: async () => {},
      pollIntervalMs: 0,
    });
    const result = await provider.generateContactSheet({
      reference: image(),
      prompt: "eight consistent views",
      quality: "high",
      seed: 77,
    });
    expect(result.imageDataUrl).toBe(`data:image/png;base64,${Buffer.from("rendered-png").toString("base64")}`);
    expect(result.model).toBe("test contact workflow");
    expect(historyCalls).toBe(2);
    expect(queuedBodies[0].prompt["6"].inputs.text).toBe("eight consistent views");
    expect(queuedBodies[0].prompt["3"].inputs).toEqual({ seed: 77, steps: 36 });
    expect(queuedBodies[0].prompt["10"].inputs.image).toBe("ai-canvas/run/reference.png");
  });

  it("uploads all eight named views and queues the handoff workflow", async () => {
    let uploadCount = 0;
    let queuedPrompt;
    const fetchFn = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/upload/image") {
        uploadCount += 1;
        return jsonResponse({ name: `view-${uploadCount}.png`, subfolder: "ai-canvas/run", type: "input" });
      }
      if (url.pathname === "/prompt") {
        queuedPrompt = JSON.parse(init.body).prompt;
        return jsonResponse({ prompt_id: "handoff-1", number: 1 });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const workflowApi = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [String(index + 1), { class_type: "LoadImage", inputs: { image: "" } }]),
    );
    const keys = ["viewFront", "viewFrontRight", "viewRight", "viewBackRight", "viewBack", "viewBackLeft", "viewLeft", "viewFrontLeft"];
    const bindings = Object.fromEntries(keys.map((key, index) => [key, [`${index + 1}.inputs.image`]]));
    const provider = new ComfyUIProvider({
      baseUrl: "http://127.0.0.1:8188",
      handoffWorkflow: { workflowApi, bindings, label: "loader" },
      fetchFn,
    });
    const ids = ["front", "front-right", "right", "back-right", "back", "back-left", "left", "front-left"];
    const result = await provider.publishViews({ views: ids.map((id) => ({ ...image(`${id}.png`), id })) });
    expect(uploadCount).toBe(8);
    expect(result.promptId).toBe("handoff-1");
    expect(result.uploaded).toHaveLength(8);
    expect(queuedPrompt["1"].inputs.image).toBe("ai-canvas/run/view-1.png");
    expect(queuedPrompt["8"].inputs.image).toBe("ai-canvas/run/view-8.png");
  });
});
