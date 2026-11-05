import { Fragment } from "react";
import { safeWebUrl } from "../lib/mail-links";
import type { MessageLink } from "../lib/message-document";

export interface MailTextPart { text: string; href?: string; }
function trimSentenceEnd(value: string) {
  let result = value.replace(/[.,;:!?]+$/, "");
  for (const [closing, opening] of [[")", "("], ["]", "["], ["}", "{"]]) {
    while (result.endsWith(closing) && result.split(closing).length > result.split(opening).length) result = result.slice(0, -1);
  }
  return result;
}
/** Does not decode, normalize, visit, or fetch signed verification URLs. */
export function tokenizeMailText(text: string): MailTextPart[] {
  const parts: MailTextPart[] = []; let offset = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'\u0000-\u001f\u007f]+/giu)) {
    const start = match.index;
    if (start > 0 && /[\p{L}\p{N}_:/.@\\-]/u.test(text[start - 1])) continue;
    const candidate = trimSentenceEnd(match[0]);
    const href = safeWebUrl(candidate);
    if (!href) continue;
    if (start > offset) parts.push({ text: text.slice(offset, start) });
    parts.push({ text: candidate, href }); offset = start + candidate.length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}
export function plainTextLinks(text: string): MessageLink[] {
  return tokenizeMailText(text).flatMap(part => part.href ? [{ href: part.href, label: part.text }] : []).filter((link, index, links) => links.findIndex(other => other.href === link.href) === index);
}
export function MailText({ text }: { text: string }) {
  return <>{tokenizeMailText(text).map((part, index) => part.href ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" title={part.href} referrerPolicy="no-referrer">{part.text}</a> : <Fragment key={index}>{part.text}</Fragment>)}</>;
}
export function MessageLinkDestinations({ links }: { links: MessageLink[] }) {
  if (!links.length) return null;
  return <details className="message-links"><summary>Link destinations <span>{links.length}</span></summary><p>Check the address before opening in a new tab.</p><ul>{links.map(link => <li key={link.href}>{link.label !== link.href && <span>{link.label}</span>}<a href={link.href} target="_blank" rel="noopener noreferrer" title={link.href} referrerPolicy="no-referrer">{link.href}</a></li>)}</ul></details>;
}
