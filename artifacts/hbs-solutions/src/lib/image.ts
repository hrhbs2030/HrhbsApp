// Client-side photo compression before upload. Phone cameras produce 4-12 MB
// JPEGs; a document scan reads fine at 2000 px on its longest side, uploads
// in seconds on mobile data and stays under the API's 10 MB limit. PDFs and
// anything that fails to decode are uploaded untouched: a failed compression
// must never block a customer from sending a document.

export const COMPRESS_OVER_BYTES = 1.5 * 1024 * 1024;
export const MAX_SIDE = 2000;
export const JPEG_QUALITY = 0.82;

export const isRasterImage = (file: { type: string; name: string }): boolean =>
  file.type === 'image/jpeg' || file.type === 'image/png' || /\.(jpe?g|png)$/i.test(file.name);

// Whether a decoded image needs re-encoding: too many bytes or too many pixels.
export const shouldCompress = (file: { type: string; name: string; size: number }, width: number, height: number): boolean =>
  isRasterImage(file) && (file.size > COMPRESS_OVER_BYTES || Math.max(width, height) > MAX_SIDE);

// Target dimensions: the longest side capped at MAX_SIDE, never upscaled.
export function targetSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_SIDE) return { width, height };
  const scale = MAX_SIDE / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Keeps the person's file name, with the extension of what is now inside it.
export const jpegName = (name: string): string => `${name.replace(/\.(jpe?g|png)$/i, '') || 'photo'}.jpg`;

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

// createImageBitmap honours the EXIF orientation that phones write, so a
// portrait photo is not uploaded on its side. Older Safari lacks the option
// (and some browsers the function), so an <img> element is the fallback;
// modern browsers apply EXIF orientation to <img> by default as well.
async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* fall through to the element */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

// The file to upload: a smaller JPEG when that helps, otherwise the original.
export async function compressImage(file: File): Promise<File> {
  if (!isRasterImage(file) || typeof document === 'undefined') return file;
  let decoded: Decoded | null = null;
  try {
    decoded = await decode(file);
    if (!shouldCompress(file, decoded.width, decoded.height)) return file;
    const { width, height } = targetSize(decoded.width, decoded.height);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // PNG transparency would turn black in JPEG; white matches paper documents.
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(decoded.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob || blob.size === 0) return file;
    // A re-encode that saves nothing (small PNG, already-tight JPEG) is not worth the quality loss.
    const downscaled = width < decoded.width || height < decoded.height;
    if (!downscaled && blob.size >= file.size) return file;
    return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  } finally { decoded?.close(); }
}
