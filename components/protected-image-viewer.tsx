 'use client';
import { useRef, useState } from 'react';
import ProfilePhoto from './profile-photo';
export default function ProtectedImageViewer({ thumbnail, original, caption }: { thumbnail: string; original: string; caption: string }) {
  const dialog = useRef<HTMLDialogElement>(null); const [open, setOpen] = useState(false);
  return <><button className="heritage-image-preview" type="button" aria-label={`${caption} зургийг томруулж харах`} onClick={() => { setOpen(true); dialog.current?.showModal(); }}><ProfilePhoto url={thumbnail} name={caption} fallback="Зураг ачаалсангүй" className="heritage-preview-thumbnail" /></button>
    <dialog ref={dialog} onClose={() => setOpen(false)} className="heritage-image-dialog" aria-label={caption}>
      <form method="dialog"><button autoFocus aria-label="Зургийг хаах">✕ Хаах</button></form>
      {open && <ProfilePhoto url={original} name={caption} fallback="Зураг ачааллах боломжгүй байна" loadingFallback="Зураг ачаалж байна…" className="heritage-preview-original" />}<p>{caption}</p>
    </dialog></>;
}
