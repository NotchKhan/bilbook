import sharp from "sharp";
import { mkdir } from "node:fs/promises";
await mkdir("public", { recursive: true });
const svg = Buffer.from(
  '<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" rx="108" fill="#0666ff"/><path d="M159 124h47v108c18-18 42-27 68-27 61 0 97 45 97 101 0 62-44 106-105 106-63 0-107-39-107-105V124zm47 181c0 39 25 64 59 64s58-25 58-63-24-61-58-61-59 24-59 60z" fill="white"/></svg>',
);
for (const size of [192, 512])
  await sharp(svg).resize(size, size).png().toFile(`public/icon-${size}.png`);
