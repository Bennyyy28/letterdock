// Explicit test preload, never imported by application code. No request is forwarded.
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const personal=id(1);
let thread={id:id(11),subject:'A calmer place for your mail',from:'Juniper Studio <hello@example.com>',read:false,email_count:1,folder:'inbox',received_at:'2026-11-04T16:30:00Z'};
let draft={id:id(21),type:'standalone',to:['recipient@example.com'],cc:[],bcc:[],subject:'A synthetic draft',text:'This is a synthetic message. No email will be sent.',html:null,snippet:'This is a synthetic message.',thread_id:null,reply_to_email_id:null,email_id:null,updated_at:'2026-11-04T17:00:00Z',attachments:[]};
function reply(body,status=200){return Response.json(body,{status});}
globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.origin!=='https://api.resend.com'||new Headers(init?.headers).get('authorization')!=='Bearer synthetic-test-key')throw new Error('Fixture blocked an unexpected network request.');
  const method=init?.method||'GET',path=url.pathname;
  if(!path.startsWith(`/inboxes/${personal}/`))return reply({data:[],has_more:false});
  if(path.endsWith('/threads')||path.endsWith('/threads/search'))return reply({data:thread.folder===(url.searchParams.get('folders')||'inbox')?[thread]:[],has_more:false});
  if(path.endsWith(`/threads/${id(11)}/emails`))return reply({data:[{id:id(12),from:thread.from,to:['you@example.com'],cc:[],subject:thread.subject,text:'Welcome to Letterdock. Your messages, one quiet home.',html:'<h2>Your inbox, docked.</h2><p>A little less noise. A little more room to think.</p><p>Keep your personal and agent inboxes together, with a familiar place to read, reply, and get back to your day.</p><p><a href="https://example.com/welcome">Explore the welcome guide</a></p><p>Made for your screen. Ready for your next idea.</p>',received_at:thread.received_at,direction:'inbound',attachments:[]}],has_more:false});
  if(path.endsWith(`/threads/${id(11)}`)){
    if(method==='PATCH')thread={...thread,...JSON.parse(init.body)};
    return reply(thread);
  }
  if(path.endsWith('/drafts')){
    if(method==='POST'){draft={...draft,...JSON.parse(init.body)};return reply({id:draft.id});}
    return reply({data:draft.email_id?[]:[draft],has_more:false});
  }
  if(path.endsWith(`/drafts/${id(21)}/send`)){
    if(method!=='POST')throw new Error('Unexpected synthetic send method.');
    draft={...draft,email_id:id(22)};return reply({id:id(22)});
  }
  if(path.endsWith(`/drafts/${id(21)}`)){
    if(method==='PATCH'){draft={...draft,...JSON.parse(init.body),updated_at:'2026-11-04T17:01:00Z'};return reply({id:draft.id});}
    return reply(draft);
  }
  throw new Error('Fixture blocked an unexpected provider endpoint.');
};
