import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, getDraft, updateDraft, reviewDraft, sendDraft, validateDraftInput, verifyReview } from '../src/lib/drafts';
import { sameOrigin } from '../src/lib/auth';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const makeWire=()=>({id:id(1),type:'standalone',to:['recipient@example.com'],cc:[],bcc:[],subject:'Synthetic draft',text:'Synthetic message only.',html:null as string|null,snippet:'Synthetic message only.',thread_id:null,reply_to_email_id:null,email_id:null,updated_at:'2026-01-01T00:00:00Z',attachments:[]});
test('draft input rejects alternate senders, agent inbox selection, header injection and oversized recipients',()=>{
 for(const extra of [{from:'assistant@example.com'},{inboxId:'assistant'},{html:'<script>bad</script>'},{headers:{}}])assert.throws(()=>validateDraftInput({requestId:id(2),text:'Hi',...extra},true));
 assert.throws(()=>validateDraftInput({requestId:id(2),to:['recipient@example.com\r\nBcc: hidden@example.com']},true));
 assert.throws(()=>validateDraftInput({requestId:id(2),to:Array(51).fill('recipient@example.com')},true));
 assert.throws(()=>validateDraftInput({requestId:id(2),subject:'bad\nsubject'},true));
 assert.throws(()=>validateDraftInput({requestId:id(2),threadId:id(3),subject:'Re: Synthetic'},true));
 assert.throws(()=>validateDraftInput({subject:'Hi'},false));
 assert.equal(sameOrigin(new Request('https://mail.example.com/api/drafts',{method:'POST',headers:{Origin:'https://other.example.com'}})),false);
 assert.equal(sameOrigin(new Request('https://mail.example.com/api/drafts',{method:'POST'})),false);
});
test('saved drafts are fixed to Personal; review never sends and stale or tampered approvals cannot send',async()=>{
 const originalFetch=globalThis.fetch;const originalKey=process.env.RESEND_API_KEY;
 process.env.RESEND_API_KEY='synthetic-test-key';let wire=makeWire();const calls:{url:string;method:string;body:unknown;key:string|null}[]=[];
 globalThis.fetch=async(input,init)=>{
  const url=String(input);const method=init?.method||'GET';const body=init?.body?JSON.parse(String(init.body)):undefined;
  calls.push({url,method,body,key:new Headers(init?.headers).get('Idempotency-Key')});
  assert.match(url,/^https:\/\/api.resend.com\/inboxes\/00000000-0000-4000-8000-000000000001\/drafts/);
  assert.equal(init?.redirect,'manual');
  if(method==='PATCH'){wire={...wire,...body,updated_at:'2026-01-02T00:00:00Z'};return Response.json({id:wire.id});}
  if(method==='POST')return Response.json({id:url.endsWith('/send')?id(9):wire.id});
  return Response.json(wire);
 };
 try{
  const draft=await createDraft({requestId:id(2),to:['recipient@example.com'],subject:'Synthetic draft',text:'Synthetic message only.'});
  assert.equal(draft.id,id(1));assert.match(calls[0].key||'',/^letterdock-draft-/);
  const review=await reviewDraft(draft.id,'user-one');assert.equal(calls.some(c=>c.url.endsWith('/send')),false);
  await assert.rejects(()=>sendDraft(draft.id,review.reviewToken,'other-user'));
  await assert.rejects(()=>sendDraft(draft.id,review.reviewToken+'tampered','user-one'));
  wire={...wire,text:'Changed by another device.'};
  await assert.rejects(()=>sendDraft(draft.id,review.reviewToken,'user-one'),/changed/);
  assert.equal(calls.some(c=>c.url.endsWith('/send')),false);
  const fresh=await reviewDraft(draft.id,'user-one');
  const result=await sendDraft(draft.id,fresh.reviewToken,'user-one');assert.equal(result.sent,true);assert.equal(result.emailId,id(9));
  const send=calls.find(c=>c.url.endsWith('/send'))!;assert.match(send.key||'',/^letterdock-send-/);assert.deepEqual(send.body,{});
  const sendCount=calls.filter(c=>c.url.endsWith('/send')).length;
  wire={...wire,html:'<p>Other format</p>'};
  await assert.rejects(()=>reviewDraft(draft.id,'user-one'),/plain text/);
  await assert.rejects(()=>updateDraft(draft.id,{expectedUpdatedAt:'stale',text:'Changed'}),/another device/);
  assert.equal(calls.filter(c=>c.url.endsWith('/send')).length,sendCount);
  wire={...makeWire()};
  const valid=await reviewDraft(draft.id,'user-one');
  const payload=JSON.parse(Buffer.from(valid.reviewToken.split('.')[0],'base64url').toString());payload.expires=Date.now()-1;
  const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('letterdock-review-v1:synthetic-test-key'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(encoded))).toString('base64url');
  const current=await getDraft(draft.id);await assert.rejects(()=>verifyReview(`${encoded}.${signature}`,draft.id,'user-one',current),/expired/);
 }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=originalKey;}
});
test('reply creation uses Resend recipient resolution and preserves an existing unsent reply',async()=>{
 const previousFetch=globalThis.fetch;const previousKey=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='synthetic-test-key';
 const wire={...makeWire(),type:'reply',to:['reply-address@example.com'],thread_id:id(3),reply_to_email_id:id(4),subject:'Existing reply',text:'Existing unsent work.'};
 const writes:{method:string;body:Record<string,unknown>}[]=[];
 globalThis.fetch=async(_input,init)=>{if(init?.method==='POST'){writes.push({method:init.method,body:JSON.parse(String(init.body))});return Response.json({id:wire.id},{status:200});}return Response.json(wire);};
 try{
  const draft=await createDraft({requestId:id(5),threadId:id(3),replyToEmailId:id(4),subject:'Re: Synthetic'});
  assert.equal(draft.text,'Existing unsent work.');assert.equal(draft.subject,'Existing reply');assert.deepEqual(draft.to,['reply-address@example.com']);
  assert.equal(writes.length,1);assert.deepEqual(writes[0].body,{subject:'Re: Synthetic',thread_id:id(3),reply_to_email_id:id(4)});
 }finally{globalThis.fetch=previousFetch;if(previousKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=previousKey;}
});
