export type MemoryFile = { type: string; size: number };

export function memoryDraftError(title: string, visibility: string, files: MemoryFile[]): string | null {
  if (!title.trim()) return 'Дурсамжийн гарчгийг бөглөнө үү.';
  if (!['private', 'family', 'public'].includes(visibility)) return 'Харагдах хүрээг сонгоно уу.';
  if (files.length > 20) return 'Нэг удаад 20 хүртэл зураг сонгоно уу.';
  if (files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) return 'Зөвхөн JPEG, PNG эсвэл WebP зураг сонгоно уу.';
  if (files.some(file => file.size > 10 * 1024 * 1024)) return 'Нэг зураг 10 MB-аас ихгүй байх ёстой.';
  return null;
}
