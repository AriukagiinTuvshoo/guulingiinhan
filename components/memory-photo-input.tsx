'use client';

import { ChangeEvent, useEffect, useState } from 'react';
import { memoryDraftError } from '../lib/memory-draft';

type Props = {
  id: string;
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
};

export default function MemoryPhotoInput({
  id,
  files,
  onChange,
  disabled = false,
  label = 'Зураг',
}: Props) {
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!incoming.length) return;
    const next = [...files, ...incoming];
    const validation = memoryDraftError('Дурсамж', 'family', next);
    if (validation) {
      setError(validation);
      return;
    }
    setError('');
    onChange(next);
  }

  function remove(index: number) {
    onChange(files.filter((_, current) => current !== index));
    setError('');
  }

  return (
    <section className="memory-photo-input memory-composer-wide" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} style={{ fontSize: 13, fontWeight: 700, color: 'var(--gt)' }}>{label}</span>
      <label className="heritage-dropzone" htmlFor={id}>
        <input
          id={id}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          hidden
          disabled={disabled}
          aria-describedby={`${id}-help`}
          onChange={choose}
        />
        <strong>📷 Зураг сонгох эсвэл энд дарж оруулна уу</strong>
        <small id={`${id}-help`}>
          JPG, PNG, WebP · 10 МБ хүртэл · Нэг удаад 20 зураг хүртэл
        </small>
      </label>
      {error && <p role="alert" className="memory-photo-input-error">{error}</p>}
      {files.length > 0 && (
        <div className="heritage-preview-grid" aria-label="Байршуулах зурагнууд">
          {files.map((file, index) => (
            <div className="heritage-preview-item" key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
              {previews[index] && <img src={previews[index]} alt={`${file.name} зургийн урьдчилан харах`} />}
              <button
                type="button"
                className="heritage-preview-remove"
                disabled={disabled}
                onClick={() => remove(index)}
                aria-label={`${file.name} зургийг жагсаалтаас хасах`}
                title="Хасах"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
