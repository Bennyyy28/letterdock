import { MailError, sendingMailbox, requireId, UUID } from './mailboxes';
import { readResend, reserveResendSlot } from './reader';
import type { DraftInput, DraftList, DraftReview, MailDraft, MailDraftSummary } from './mail-types';

const draftBase = () => `/inboxes/${sendingMailbox().id}/drafts`;
type WireDraft = { id:string; type:'standalone'|'reply'; to:string[]|null; cc:string[]; bcc:string[]; subject:string|null; text?:string|null; html?:string|null; snippet?:string|null; thread_id:string|null; reply_to_email_id:string|null; email_id?:string|null; updated_at:string; attachments:{id:string;filename:string;size:number;content_type:string}[] };
export function draftSummary(d:WireDraft):MailDraftSummary {
 return {id:requireId(d.id),type:d.type,to:d.to||[],cc:d.cc||[],bcc:d.bcc||[],subject:d.subject||'',snippet:d.snippet||'',threadId:d.thread_id,replyToEmailId:d.reply_to_email_id,updatedAt:d.updated_at,attachments:(d.attachments||[]).map(a=>({id:a.id,filename:a.filename,size:a.size,contentType:a.content_type}))};
}
export function draftDetail(d:WireDraft):MailDraft {return {...draftSummary(d),text:d.text||'',hasHtml:!!d.html,emailId:d.email_id||null};}
export async function listDrafts(after?:string):Promise<DraftList> {
 const params=new URLSearchParams({limit:'25'});if(after)params.set('after',requireId(after));
 const page=await readResend<{data:WireDraft[];has_more:boolean}>(`${draftBase()}?${params}`);
 if(!Array.isArray(page.data)||typeof page.has_more!=='boolean'||(page.has_more&&!page.data.length))throw new MailError('The draft list could not be read completely.');
 return {drafts:page.data.map(draftSummary),hasMore:page.has_more,nextCursor:page.has_more?page.data.at(-1)?.id:undefined};
}
export async function getDraft(id:string):Promise<MailDraft> {return draftDetail(await readResend<WireDraft>(`${draftBase()}/${requireId(id)}`));}

// Only these draft operations exist. There is no caller-selected inbox or From.
async function writeDraft(path:string, method:'POST'|'PATCH', body:unknown, idempotencyKey?:string) {
 const base=draftBase(); // Enforce the sender before any timer or network error handler.
 const key=process.env.RESEND_API_KEY;if(!key)throw new MailError('The mail connection needs attention.',503);
 await reserveResendSlot();
 let response:Response;
 try {response=await fetch(`https://api.resend.com${base}${path}`,{method,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:JSON.stringify(body),cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(15000)});}
 catch {throw new MailError('The request did not finish. Check Drafts or Sent before trying again; the result may already be saved.',502);}
 if(!response.ok) {
  if(response.status===409)throw new MailError('This draft changed or was already sent. Reopen it before continuing.',409);
  if(response.status===404)throw new MailError('This draft or reply conversation is no longer available.',404);
  if(response.status===429)throw new MailError('Mail is busy. Wait a moment before trying again.',429);
  if(response.status===422||response.status===400)throw new MailError('Resend could not accept this draft. Check the recipients, subject and message.',422);
  throw new MailError('The mail request could not be completed. Check Drafts or Sent before retrying.',502);
 }
 const result=await response.json() as {id:string};return requireId(result.id);
}

function object(value:unknown):Record<string,unknown> {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new MailError('Invalid draft request.',400);
 return value as Record<string,unknown>;
}
function addresses(value:unknown):string[] {
 if(!Array.isArray(value)||value.length>50)throw new MailError('Use up to 50 email recipients.',400);
 return value.map(v=>{
  if(typeof v!=='string'||v.length>320||/[\r\n\0]/.test(v))throw new MailError('Enter valid email addresses.',400);
  const trimmed=v.trim();const address=trimmed.match(/^(?:[^<>]+\s)?<([^<>]+)>$/)?.[1]||trimmed;
  if(!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address))throw new MailError('Enter valid email addresses.',400);
  return trimmed;
 });
}
export function validateDraftInput(value:unknown, creating:boolean):{input:DraftInput;requestId?:string;expectedUpdatedAt?:string} {
 const data=object(value);const allowed=['to','cc','bcc','subject','text',...(creating?['threadId','replyToEmailId','requestId']:['expectedUpdatedAt'])];
 if(Object.keys(data).some(k=>!allowed.includes(k)))throw new MailError('Only draft fields can be changed.',400);
 const input:DraftInput={};
 for(const field of ['to','cc','bcc'] as const)if(data[field]!==undefined)input[field]=addresses(data[field]);
 if((input.to?.length||0)+(input.cc?.length||0)+(input.bcc?.length||0)>50)throw new MailError('Use up to 50 recipients in total.',400);
 for(const field of ['subject','text'] as const)if(data[field]!==undefined){const v=data[field];if(typeof v!=='string'||v.length>(field==='subject'?2000:100000)||v.includes('\0')||(field==='subject'&&/[\r\n]/.test(v)))throw new MailError('The subject or message is invalid or too long.',400);input[field]=v;}
 if(creating){
  if(typeof data.requestId!=='string'||!UUID.test(data.requestId))throw new MailError('A draft request identifier is required.',400);
  if(data.threadId!==undefined||data.replyToEmailId!==undefined){if(typeof data.threadId!=='string'||typeof data.replyToEmailId!=='string')throw new MailError('Choose the message to reply to.',400);input.threadId=requireId(data.threadId);input.replyToEmailId=requireId(data.replyToEmailId);}
 }else if(typeof data.expectedUpdatedAt!=='string'||!data.expectedUpdatedAt)throw new MailError('Reopen this draft before saving changes.',409);
 if(!Object.entries(input).some(([k,v])=>k!=='threadId'&&k!=='replyToEmailId'&&(typeof v==='string'?!!v.trim():Array.isArray(v)&&v.length)))throw new MailError('Add a recipient, subject or message before saving.',400);
 return {input,requestId:data.requestId as string|undefined,expectedUpdatedAt:data.expectedUpdatedAt as string|undefined};
}
function wireInput(input:DraftInput) {return {...(input.to!==undefined?{to:input.to}:{}),...(input.cc!==undefined?{cc:input.cc}:{}),...(input.bcc!==undefined?{bcc:input.bcc}:{}),...(input.subject!==undefined?{subject:input.subject.trim()?input.subject:null}:{}),...(input.text!==undefined?{text:input.text,html:null}:{}),...(input.threadId?{thread_id:input.threadId,reply_to_email_id:input.replyToEmailId}:{})};}
export async function createDraft(value:unknown) {
 const {input,requestId}=validateDraftInput(value,true);
 const id=await writeDraft('','POST',wireInput(input),`letterdock-draft-${requestId}`);
 // Reply creation may return an existing unsent draft. Read it; never overwrite it.
 return getDraft(id);
}
export async function updateDraft(id:string,value:unknown) {
 requireId(id);const {input,expectedUpdatedAt}=validateDraftInput(value,false);const current=await getDraft(id);
 if(current.emailId||current.updatedAt!==expectedUpdatedAt)throw new MailError('This draft changed on another device. Reopen it before saving.',409);
 await writeDraft(`/${id}`,'PATCH',wireInput(input));return getDraft(id);
}

const encoder=new TextEncoder();
async function hmacKey(){const secret=process.env.RESEND_API_KEY;if(!secret)throw new MailError('The mail connection needs attention.',503);return crypto.subtle.importKey('raw',encoder.encode(`letterdock-review-v1:${secret}`),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function fingerprint(draft:MailDraft){return Buffer.from(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(draft)))).toString('base64url');}
export function validateSendable(draft:MailDraft){
 if(draft.emailId)throw new MailError('This draft was already sent.',409);
 if(draft.hasHtml)throw new MailError('Save this draft as plain text before reviewing it.',400);
 if(!draft.to.length||!draft.text.trim()||!draft.subject.trim())throw new MailError('Add a To recipient, subject and message before reviewing.',400);
 addresses(draft.to);addresses(draft.cc);addresses(draft.bcc);
 if(draft.to.length+draft.cc.length+draft.bcc.length>50)throw new MailError('Use up to 50 recipients in total.',400);
}
export async function reviewDraft(id:string,userId:string):Promise<DraftReview>{
 const draft=await getDraft(id);validateSendable(draft);
 const expires=Date.now()+10*60*1000;
 const payload=Buffer.from(JSON.stringify({v:1,id:draft.id,userId,hash:await fingerprint(draft),expires})).toString('base64url');
 const signature=Buffer.from(await crypto.subtle.sign('HMAC',await hmacKey(),encoder.encode(payload))).toString('base64url');
 return {draft,reviewToken:`${payload}.${signature}`,expiresAt:new Date(expires).toISOString()};
}
export async function verifyReview(token:unknown,id:string,userId:string,draft:MailDraft){
 if(typeof token!=='string'||token.length>3000)throw new MailError('Review this draft before sending.',400);
 try {
  const [payload,signature,extra]=token.split('.');if(!payload||!signature||extra)throw Error();
  if(!await crypto.subtle.verify('HMAC',await hmacKey(),Buffer.from(signature,'base64url'),encoder.encode(payload)))throw Error();
  const data=JSON.parse(Buffer.from(payload,'base64url').toString());
  if(data.v!==1||data.id!==id||data.userId!==userId||typeof data.expires!=='number'||data.expires<Date.now()||data.expires>Date.now()+10*60*1000||data.hash!==await fingerprint(draft))throw Error();
 }catch{throw new MailError('The review expired or the draft changed. Review it again before sending.',409);}
}
export async function sendDraft(id:string,token:unknown,userId:string){
 requireId(id);const draft=await getDraft(id);validateSendable(draft);await verifyReview(token,id,userId,draft);
 const hash=await fingerprint(draft);
 const emailId=await writeDraft(`/${id}/send`,'POST',{},`letterdock-send-${id}-${hash}`);
 return {sent:true as const,emailId};
}
