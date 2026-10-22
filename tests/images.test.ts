import { expect, it } from "vitest";
import sharp from "sharp";
import { imagePolicy } from "../src/lib/image-policy";
it("keeps avatar dimensions small without enlarging small photos", async () => {
  for (const sourceEdge of [80, 1600]) {
    const policy = imagePolicy("avatar");
    const source = await sharp({ create: { width: sourceEdge, height: sourceEdge / 2, channels: 3, background: "#765432" } }).png().toBuffer();
    const encoded = await sharp(source).resize({ width: policy.edge, height: policy.edge, fit: "inside", withoutEnlargement: true }).webp({ quality: policy.quality }).toBuffer();
    const meta = await sharp(encoded).metadata();
    expect(meta.width).toBe(Math.min(sourceEdge, 256));
    expect(meta.height).toBe(Math.min(sourceEdge, 256) / 2);
    expect(meta.format).toBe("webp");
  }
});
it("retains resolution for request evidence and bounds feed photos", () => {
  expect(imagePolicy("request").edge).toBe(1600);
  expect(imagePolicy("news").edge).toBe(1440);
  expect(imagePolicy("story").edge).toBe(1440);
});
