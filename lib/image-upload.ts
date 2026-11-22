/** Prepare mobile camera/library files for the existing private image API. */
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';
export const PHOTO_CHANGED_EVENT = 'guulingiinhan:photo-changed';
export type PhotoChange = { endpoint: string; hasPhoto: boolean; url: string | null };
const LIMIT = 10 * 1024 * 1024;
const HEIC_MESSAGE = 'Энэ HEIC / HEIF зургийг browser хөрвүүлж чадсангүй. Photos-оос JPEG хэлбэрээр экспортлох, эсвэл iPhone-ийн Settings → Camera → Formats → Most Compatible тохиргоогоор шинэ зураг авч сонгоно уу.';

export function announcePhotoChange(detail: PhotoChange) {
  window.dispatchEvent(new CustomEvent<PhotoChange>(PHOTO_CHANGED_EVENT, { detail }));
}

export function detectedImageType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return 'image/png';
  const text = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
  if (text(4, 8) === 'ftyp' && /heic|heix|hevc|hevx|mif1|msf1/.test(text(8, 32))) return 'image/heic';
  return null;
}

function imageName(original: string, type: string) {
  const stem = original.replace(/\.[^.]*$/, '').trim() || 'photo';
  return `${stem}.${type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'}`;
}

async function convertHeic(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') throw new Error(HEIC_MESSAGE);
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new Error(HEIC_MESSAGE);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(HEIC_MESSAGE);
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob || blob.type !== 'image/jpeg') throw new Error(HEIC_MESSAGE);
    return blob;
  } catch { throw new Error(HEIC_MESSAGE); }
  finally { bitmap?.close(); }
}

export async function prepareImageUpload(file: File): Promise<File> {
  if (!file.size) throw new Error('Хоосон файл байна. Өөр зураг сонгоно уу.');
  if (file.size > LIMIT) throw new Error('Зураг 10 МБ-аас хэтрэхгүй байна.');
  // Actual bytes are authoritative: iOS may omit MIME or use image/jpg, and
  // exported JPEGs can retain a HEIC filename. Backend still validates/strips EXIF.
  const type = detectedImageType(new Uint8Array(await file.slice(0, 32).arrayBuffer()));
  if (!type) throw new Error('JPG, PNG эсвэл WebP зураг сонгоно уу. Файлын нэрийг солих нь зургийн төрлийг өөрчлөхгүй.');
  const blob = type === 'image/heic' ? await convertHeic(file) : file;
  if (blob.size > LIMIT) throw new Error('Хөрвүүлсэн зураг 10 МБ-аас хэтэрлээ. Жижиг хэмжээтэй JPEG экспортолж сонгоно уу.');
  const outputType = type === 'image/heic' ? 'image/jpeg' : type;
  return new File([blob], imageName(file.name, outputType), { type: outputType, lastModified: file.lastModified });
}
