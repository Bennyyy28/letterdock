import sanitizeHtml from 'sanitize-html';
import { safeWebUrl } from './mail-links';
import type { Folder, MailMessage, MailThread, ThreadDetail, ThreadList } from './mail-types';
import { mailbox, MAILBOXES, MailError, requireId, UUID } from './mailboxes';

type WireThread = { id:string; subject:string|null; from?:string|null; received_at?:string; read:boolean; email_count?:number; folder:Folder };
type WireEmail = { id:string; from:string; to:string[]; cc:string[]; subject:string|null; text:string|null; html:string|null; received_at:string; direction:'inbound'|'outbound'; attachments:{id:string;filename:string|null;size:number|null}[] };
type Page<T> = {data:T[];has_more:boolean};
type Cursor = {v:1;scope:string;positions:Record<string,string>;done:string[]};
let nextRequestAt = 0;
export async function reserveResendSlot() {
  // Reserve a process-local timestamp; requests own their timers.
  // Multiple server instances need shared rate limiting at the deployment layer.
  const now = Date.now();
  const scheduledAt = Math.max(now, nextRequestAt);
  nextRequestAt = scheduledAt + 600;
  if (scheduledAt > now) await new Promise(r=>setTimeout(r, scheduledAt-now));
}
export async function readResend<T>(path:string, key = process.env.RESEND_API_KEY):Promise<T> {
  if (!key) throw new MailError('Connect Resend to read your inboxes.', 503);
  if (!/^\/inboxes(?:\/|\?|$)/.test(path) || path.includes('..')) throw new MailError('Invalid mail request.',400);
  for (let attempt=0;attempt<2;attempt++) {
    await reserveResendSlot();
    let response:Response;
    try { response = await fetch(`https://api.resend.com${path}`, {method:'GET',headers:{Authorization:`Bearer ${key}`},cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(15000)}); }
    catch { throw new MailError('Resend could not be reached. Please try again.'); }
    if (response.status===429 && attempt===0) { await new Promise(r=>setTimeout(r, Math.min(5000, Math.max(1000, Number(response.headers.get('retry-after')||1)*1000)))); continue; }
    if (!response.ok) {
      if (response.status===401 || response.status===403) throw new MailError('The Resend key cannot read these inboxes. Check its permissions.',503);
      if (response.status===404) throw new MailError('This inbox or conversation could not be found.',404);
      if (response.status===429) throw new MailError('Resend is rate limiting requests. Try again shortly.',429);
      throw new MailError('Resend could not complete this read. Please try again.');
    }
    return response.json() as Promise<T>;
  }
  throw new MailError('Resend is busy. Try again shortly.',429);
}
export function cleanHtml(html:string):string {
  return sanitizeHtml(html, { allowedTags:['p','br','div','span','b','strong','em','i','u','s','blockquote','pre','code','ul','ol','li','h1','h2','h3','h4','h5','h6','hr','table','thead','tbody','tfoot','tr','th','td','a'], allowedAttributes:{a:['href','target','rel','title'],td:['colspan','rowspan'],th:['colspan','rowspan']}, allowedSchemes:['http','https'], allowProtocolRelative:false, transformTags:{
    a: (_tag, attributes): sanitizeHtml.Tag => {
      const href = safeWebUrl(attributes.href || '');
      return {tagName:'a', attribs:href ? {href,target:'_blank',rel:'noopener noreferrer',title:href} : {}};
    }
  }, disallowedTagsMode:'discard' });
}
export function normalizeThread(thread:WireThread, key:string):MailThread {
  const box = mailbox(key);
  return { id:requireId(thread.id), inboxId:box.id, inboxKey:box.key, subject:thread.subject || '(No subject)', sender:thread.from || '', preview:'', updatedAt:thread.received_at || '', unread:!thread.read, messageCount:thread.email_count || 1, folder:thread.folder };
}
export function normalizeMessage(email:WireEmail):MailMessage {
  return { id:requireId(email.id),from:email.from,to:email.to || [],cc:email.cc || [],subject:email.subject || '(No subject)',text:email.text || '',safeHtml:email.html ? cleanHtml(email.html) : undefined,receivedAt:email.received_at, direction:email.direction, attachments:(email.attachments || []).map(a=>({id:a.id,filename:a.filename || 'Attachment',size:a.size ?? undefined})) };
}
export function decodeCursor(raw:string|undefined, scope:string):Cursor {
  if (!raw) return {v:1,scope,positions:{},done:[]};
  if (raw.length>4000) throw new MailError('Invalid page cursor.',400);
  try {
    const c=JSON.parse(Buffer.from(raw,'base64url').toString()) as Cursor;
    if(c.v!==1 || c.scope!==scope || !c.positions || typeof c.positions!=='object' || !Array.isArray(c.done)) throw Error();
    for(const [key,id] of Object.entries(c.positions)) {mailbox(key);if(typeof id!=='string' || !UUID.test(id))throw Error();}
    c.done.forEach(key=>mailbox(key));
    return c;
  } catch { throw new MailError('This page cursor has expired. Refresh the inbox.',400); }
}
export function mergePages(pages:{key:string;page:Page<WireThread>}[], cursor:Cursor, limit=25):ThreadList {
  const sorted=pages.flatMap(({key,page})=>page.data.map(t=>normalizeThread(t,key))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
  const threads=sorted.slice(0,limit);
  const positions={...cursor.positions};
  const done=new Set(cursor.done);
  for(const {key,page} of pages) {
    const consumed=threads.filter(t=>t.inboxKey===key);
    if(consumed.length) positions[key]=consumed[consumed.length-1].id;
    if(!page.has_more && consumed.length===page.data.length) done.add(key);
  }
  const hasMore=pages.some(({key,page})=>!done.has(key) && (page.has_more || page.data.length>threads.filter(t=>t.inboxKey===key).length));
  return {threads,hasMore,nextCursor:hasMore?Buffer.from(JSON.stringify({...cursor,positions,done:[...done]})).toString('base64url'):undefined};
}
export async function listThreads(inbox:string, folder:Folder, q:string, rawCursor?:string):Promise<ThreadList> {
  const selected=inbox==='all'?MAILBOXES:[mailbox(inbox)];
  const scope=JSON.stringify([inbox,folder,q]);
  const cursor=decodeCursor(rawCursor,scope);
  const pages=await Promise.all(selected.filter(b=>!cursor.done.includes(b.key)).map(async box=>{
    const params=new URLSearchParams({folders:folder,limit:'25'});
    if(q)params.set('query',q);
    if(cursor.positions[box.key])params.set('after',cursor.positions[box.key]);
    const page=await readResend<Page<WireThread>>(`/inboxes/${box.id}/threads${q?'/search':''}?${params}`);
    if(!Array.isArray(page.data)||typeof page.has_more!=='boolean')throw new MailError('Resend returned an incomplete inbox response.');
    if(page.has_more&&!page.data.length)throw new MailError('Resend returned an incomplete page. Please refresh.');
    return {key:box.key,page};
  }));
  return mergePages(pages,cursor);
}
export async function getThread(key:string, id:string):Promise<ThreadDetail> {
  const box=mailbox(key);requireId(id);
  const summary=await readResend<WireThread>(`/inboxes/${box.id}/threads/${id}`);
  const all:WireEmail[]=[];
  let after='';
  for(let pageNumber=0;pageNumber<100;pageNumber++) {
    const query=new URLSearchParams({limit:'100'});if(after)query.set('after',after);
    const page=await readResend<Page<WireEmail>>(`/inboxes/${box.id}/threads/${id}/emails?${query}`);
    if(!Array.isArray(page.data) || typeof page.has_more!=='boolean')throw new MailError('Resend returned an incomplete conversation.');
    all.push(...page.data);
    if(!page.has_more) {
      const latest=all[all.length-1];
      return {thread:normalizeThread({...summary,from:latest?.from,received_at:latest?.received_at,email_count:all.length},key),messages:all.map(normalizeMessage)};
    }
    const next=page.data[page.data.length-1]?.id;
    if(!next || next===after)throw new MailError('The conversation could not be read completely. Please try again.');
    after=requireId(next);
  }
  throw new MailError('This conversation is too large to read in one request.');
}
