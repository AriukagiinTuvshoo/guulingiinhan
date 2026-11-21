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
      <label id={`${id}-label`} htmlFor={id}>{label}</label>
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={disabled}
        aria-describedby={`${id}-help`}
        onChange={choose}
      />
      <small id={`${id}-help`}>
        JPEG, PNG, WebP зураг; нэг файл 10 MB-аас ихгүй, нэг удаад 20 хүртэл.
        Бичлэг байршуулах боломж одоогоор байхгүй.
      </small>
      {error && <p role="alert" className="memory-photo-input-error">{error}</p>}
      {files.length > 0 && (
        <ul className="memory-photo-queue" aria-label="Байршуулах зурагнууд">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
              {previews[index] && <img src={previews[index]} alt={`${file.name} зургийн урьдчилан харах`} />}
              <span title={file.name}>{file.name}</span>
              <small>{(file.size / (1024 * 1024)).toFixed(1)} MB</small>
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(index)}
                aria-label={`${file.name} зургийг жагсаалтаас хасах`}
              >
                Хасах
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
