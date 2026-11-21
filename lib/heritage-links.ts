export type HeritageKind = 'story' | 'memory' | 'archive' | 'event';
export const heritageLabels: Record<HeritageKind, string> = { story: 'Түүх', memory: 'Дурсамж', archive: 'Архив', event: 'Үйл явдал' };
export const linkToken = /\[\[link:(story|memory|archive|event):([0-9a-fA-F-]{36})\]\]/g;
export function stripHeritageLinks(content: string) { return content.replace(linkToken, '').trim(); }
export function heritageEditorText(content: string) {
  return content.replace(/(?:\r?\n)*\[\[link:(story|memory|archive|event):([0-9a-fA-F-]{36})\]\]/g, '');
}
export function editHeritageText(text: string, current: string) {
  const links = [...current.matchAll(linkToken)].map(match => match[0]);
  return text + (links.length ? '\n\n' + links.join('\n') : '');
}
