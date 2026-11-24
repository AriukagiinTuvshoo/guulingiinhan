'use client';

import { useEffect, useRef, useState } from 'react';
import { Film, Mic, Sparkles, Square, Trash2, Upload } from 'lucide-react';

export const INTERVIEW_PROMPTS = [
  'Өвөө, эмээ чинь хаана төрсөн, ямар нутаг устай байсан бэ?',
  'Хүүхэд насны хамгийн дурсамжтай өдөр эсвэл баяр юу байсан бэ?',
  'Таны нэрийг хэн өгсөн, ямар утга бэлгэдэлтэй вэ?',
  'Амьдралынхаа туршид ямар ажил хөдөлмөр эрхэлж байсан бэ?',
  'Гэр бүлд ямар зан заншил, уламжлал үе дамжин хадгалагдсан бэ?',
  'Үр хойчдоо ямар захиас, сургаал үлдээмээр байна вэ?',
];

interface OralHistoryRecorderProps {
  onInsertPrompt: (promptText: string) => void;
  onAttachMediaNote?: (summaryLine: string) => void;
}

export default function OralHistoryRecorder({
  onInsertPrompt,
  onAttachMediaNote,
}: OralHistoryRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaKind, setMediaKind] = useState<'audio' | 'video' | null>(null);
  const [mediaName, setMediaName] = useState('');
  const [recorderError, setRecorderError] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    };
  }, [mediaUrl]);

  async function startRecording() {
    setRecorderError('');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setRecorderError('Энэ хөтөч дээр микрофон бичлэг дэмжигдэхгүй байна. Доорх товчоор аудио/MP4 файл оруулна уу.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (mediaUrl) URL.revokeObjectURL(mediaUrl);
        const url = URL.createObjectURL(blob);
        setMediaUrl(url);
        setMediaKind('audio');
        const label = `Аман түүхийн дуу бичлэг (${formatDuration(seconds)})`;
        setMediaName(label);
        onAttachMediaNote?.(`[🎙️ ${label}]`);
        stream.getTracks().forEach((t) => t.stop());
      };
      recorderRef.current = rec;
      rec.start();
      setSeconds(0);
      setRecording(true);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setRecorderError('Микрофоны зөвшөөрөл олгогдоогүй байна.');
    }
  }

  function stopRecording() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    recorderRef.current?.stop();
    setRecording(false);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setRecorderError('');
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    const url = URL.createObjectURL(file);
    const kind = file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mp4') ? 'video' : 'audio';
    setMediaUrl(url);
    setMediaKind(kind);
    setMediaName(file.name);
    onAttachMediaNote?.(kind === 'video' ? `[🎬 Видео бичлэг: ${file.name}]` : `[🎙️ Аудио бичлэг: ${file.name}]`);
  }

  function clearMedia() {
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    setMediaUrl(null);
    setMediaKind(null);
    setMediaName('');
  }

  return (
    <aside className="oral-history-studio" aria-label="Аман түүх ба ярилцлагын туслах">
      <div className="oral-history-card">
        <div className="oral-history-card__head">
          <span className="oral-history-tag">АМАН ТҮҮХ · ДУУ &amp; MP4</span>
          <h3>Дуу хоолой ба Видео бичлэг</h3>
          <p>Ахмад настны яриаг шууд дуугаар бичих эсвэл MP4 видео/аудио файл хавсаргаж хадгална.</p>
        </div>

        <div className="oral-history-controls">
          {!recording ? (
            <button type="button" className="oral-btn oral-btn--rec" onClick={() => void startRecording()}>
              <Mic size={15} /> Дуу хоолой бичих
            </button>
          ) : (
            <button type="button" className="oral-btn oral-btn--stop" onClick={stopRecording}>
              <Square size={14} /> Зогсоох ({formatDuration(seconds)})
            </button>
          )}

          <label className="oral-btn oral-btn--upload">
            <Upload size={15} /> MP4 / Аудио оруулах
            <input
              type="file"
              accept="audio/*,video/mp4,video/quicktime,.mp4,.m4a,.mp3,.wav"
              onChange={handleFileChange}
              hidden
            />
          </label>
        </div>

        {recorderError && <p className="oral-error">{recorderError}</p>}

        {mediaUrl && (
          <div className="oral-preview">
            <div className="oral-preview__meta">
              {mediaKind === 'video' ? <Film size={15} /> : <Mic size={15} />}
              <strong>{mediaName}</strong>
              <button type="button" className="oral-clear" onClick={clearMedia} aria-label="Хавсралт арилгах">
                <Trash2 size={14} />
              </button>
            </div>
            {mediaKind === 'video' ? (
              <video src={mediaUrl} controls className="oral-video" />
            ) : (
              <audio src={mediaUrl} controls className="oral-audio" />
            )}
            <div className="oral-ai-badge">
              <Sparkles size={13} />
              <span>AI автомат текст хөрвүүлэлтэд бэлэн формат (удахгүй холбогдоно)</span>
            </div>
          </div>
        )}
      </div>

      <div className="oral-history-card">
        <div className="oral-history-card__head">
          <span className="oral-history-tag">ЯРИЛЦЛАГЫН АСУУЛГА</span>
          <h3>Ахмадтай ярилцах 6 асуулт</h3>
          <p>Дуртай асуулт дээр дарахад түүхийн бичвэр дотор шууд орно.</p>
        </div>
        <div className="oral-prompts">
          {INTERVIEW_PROMPTS.map((q) => (
            <button key={q} type="button" className="oral-prompt-btn" onClick={() => onInsertPrompt(q)}>
              {q}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
