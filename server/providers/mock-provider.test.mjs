import { describe, expect, it } from "vitest";
import { MockImageProvider, MOCK_VIEW_IDS } from "./mock-provider.mjs";

describe("MockImageProvider", () => {
  it("returns an embedded 2048 by 1024 SVG contact sheet", async () => {
    const provider = new MockImageProvider();
    const result = await provider.generateContactSheet({ prompt: "coral jacket", seed: 24 });
    const source = Buffer.from(result.imageDataUrl.split(",")[1], "base64").toString("utf8");

    expect(result.provider).toBe("mock");
    expect(result.model).toBe("mock-turntable-v1");
    expect(source).toContain('width="2048"');
    expect(source).toContain('height="1024"');
    expect((source.match(/<g transform="translate\(/g) || []).length).toBeGreaterThanOrEqual(8);
  });

  it("supports every configured retry view", async () => {
    const provider = new MockImageProvider();
    expect(MOCK_VIEW_IDS).toHaveLength(8);
    for (const viewId of MOCK_VIEW_IDS) {
      const result = await provider.generateView({ prompt: "same character", viewId, seed: 24 });
      expect(result.imageDataUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);
    }
  });
});
