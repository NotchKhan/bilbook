// Compress before crossing Vercel's request-size limit; the server revalidates/re-encodes.
import { imagePolicy } from "./image-policy";
export async function compressImage(file: File, purpose = "news"): Promise<File> {
  if (
    file.size > 8 * 1024 * 1024 ||
    !["image/jpeg", "image/png", "image/webp"].includes(file.type)
  )
    throw Error("Фото: JPEG, PNG или WebP, до 8 МБ.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw Error("Не удалось прочитать фото. Выберите JPEG, PNG или WebP.");
  }
  try {
    if (bitmap.width * bitmap.height > 40000000)
      throw Error("Размер изображения превышает 40 мегапикселей.");
    const policy = imagePolicy(purpose);
    const ratio = Math.min(1, policy.edge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw Error("Браузер не поддерживает обработку фото.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (v) => (v ? resolve(v) : reject(Error("Не удалось сжать фото."))),
        "image/webp",
        policy.quality / 100,
      ),
    );
    if (blob.size > 3 * 1024 * 1024)
      throw Error(
        "Фото слишком большое после сжатия. Выберите другое изображение.",
      );
    return new File(
      [blob],
      "photo." + (blob.type === "image/webp" ? "webp" : "png"),
      { type: blob.type },
    );
  } finally {
    bitmap.close();
  }
}
