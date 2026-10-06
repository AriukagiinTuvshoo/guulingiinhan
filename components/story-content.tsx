import { Fragment, ReactNode } from 'react';
import ProfilePhoto from './profile-photo';

type Props = {
  body: string;
  familyId?: string;
  publicPhotoUrls?: string[];
};

const photoLine = /^\[\[photo:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\|([^\]\n]{0,180}))?\]\]$/;
const inlineParts = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\(https:\/\/[^\s)]+\))/g;

function inline(text: string): ReactNode[] {
  return text.split(inlineParts).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/.exec(part);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer nofollow">{link[1]}</a>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export default function StoryContent({ body, familyId, publicPhotoUrls }: Props) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let listType: 'ul' | 'ol' = 'ul';
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(<p key={`p-${blocks.length}`}>{paragraph.map((line, index) => <Fragment key={index}>{index > 0 && <br />}{inline(line)}</Fragment>)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    const items = list.map((line, index) => <li key={index}>{inline(line)}</li>);
    blocks.push(listType === 'ul' ? <ul key={`l-${blocks.length}`}>{items}</ul> : <ol key={`l-${blocks.length}`}>{items}</ol>);
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    const photo = photoLine.exec(line);
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (photo || heading || bullet || numbered || line.startsWith('> ') || line === '---' || !line) flushParagraph();
    if (!bullet && !numbered) flushList();
    if (!line) continue;
    if (photo) {
      const id = photo[1].toLowerCase();
      const caption = photo[2]?.trim() || 'Гэр бүлийн зураг';
      const approved = publicPhotoUrls?.find((url) => url.endsWith(`/${id}/thumbnail`));
      const url = publicPhotoUrls ? approved : familyId ? `/families/${familyId}/photos/${id}/content?variant=thumbnail` : null;
      if (url) blocks.push(<figure className="story-inline-photo" key={`i-${blocks.length}`}><ProfilePhoto url={url} name={caption} fallback="Зураг харах эрхгүй эсвэл зураг олдсонгүй" className="story-inline-image" /><figcaption>{caption}</figcaption></figure>);
      else if (publicPhotoUrls) blocks.push(<figure className="story-inline-photo" key={`i-${blocks.length}`}><div className="story-inline-image-fallback" role="img" aria-label="Энэ зураг нийтэд хуваалцах зөвшөөрөлгүй">Энэ зураг нийтэд хуваалцаагүй.</div><figcaption>{caption}</figcaption></figure>);
      continue;
    }
    if (heading) {
      const content = inline(heading[2]);
      blocks.push(heading[1].length === 1 ? <h2 key={`h-${blocks.length}`}>{content}</h2> : <h3 key={`h-${blocks.length}`}>{content}</h3>);
      continue;
    }
    if (line === '---') { blocks.push(<hr key={`r-${blocks.length}`} />); continue; }
    if (line.startsWith('> ')) { blocks.push(<blockquote key={`q-${blocks.length}`}>{inline(line.slice(2))}</blockquote>); continue; }
    if (bullet || numbered) {
      const nextType = bullet ? 'ul' : 'ol';
      if (list.length && listType !== nextType) flushList();
      listType = nextType;
      list.push((bullet || numbered)![1]);
      continue;
    }
    paragraph.push(raw);
  }
  flushParagraph();
  flushList();
  return <div className="story-content">{blocks}</div>;
}
