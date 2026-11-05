import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanHtml, decodeCursor, mergePages, normalizeMessage } from '../src/lib/reader';
import { sameOrigin } from '../src/lib/auth';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const thread=(n:number, time:number)=>({id:id(n),subject:'Example',from:'sender@example.com',read:false,email_count:1,folder:'inbox' as const,received_at:new Date(time*1000).toISOString()});
test('all-inbox pagination advances only consumed threads and preserves unequal inbox ordering',()=>{
 const cursor={v:1 as const,scope:'all',positions:{},done:[]};
 const page=mergePages([{key:'personal',page:{data:[thread(1,100),thread(2,90),thread(3,80)],has_more:true}},{key:'agents',page:{data:[thread(4,20)],has_more:false}}],cursor,2);
 assert.deepEqual(page.threads.map(t=>t.id),[id(1),id(2)]);assert.equal(page.hasMore,true);
 const next=decodeCursor(page.nextCursor,'all');assert.equal(next.positions.personal,id(2));assert.equal(next.positions.agents,undefined);assert.deepEqual(next.done,[]);
 const end=mergePages([{key:'personal',page:{data:[thread(3,80)],has_more:false}},{key:'agents',page:{data:[thread(4,20)],has_more:false}}],next,2);
 assert.deepEqual(end.threads.map(t=>t.id),[id(3),id(4)]);assert.equal(end.hasMore,false);
});
test('cursor rejects altered search scope, invalid IDs and unknown inboxes',()=>{
 const encode=(o:unknown)=>Buffer.from(JSON.stringify(o)).toString('base64url');
 assert.throws(()=>decodeCursor(encode({v:1,scope:'old',positions:{},done:[]}),'new'));
 assert.throws(()=>decodeCursor(encode({v:1,scope:'x',positions:{personal:'../../escape'},done:[]}),'x'));
 assert.throws(()=>decodeCursor(encode({v:1,scope:'x',positions:{other:id(1)},done:[]}),'x'));
});
test('HTML removes scripts, tracking images, remote CSS, forms and active URL schemes',()=>{
 const safe=cleanHtml('<p onclick="alert(1)">Hello <strong>Personal</strong></p><script>steal()</script><iframe src="https://evil.test"></iframe><img src="https://tracker.test/pixel"><a href="javascript:alert(1)" target="_top">link</a><form action="https://evil.test"><input></form><div style="background:url(https://tracker.test)">body</div><svg onload="alert(2)"></svg>');
 assert.match(safe,/<strong>Personal<\/strong>/);assert.doesNotMatch(safe,/script|iframe|img|href|onclick|style|form|input|svg|https:/i);
});
test('message normalization exposes attachment metadata without inventing download links',()=>{
 const m=normalizeMessage({id:id(1),from:'a@example.com',to:[],cc:[],subject:null,text:'Hi',html:null,received_at:'2026-01-01T00:00:00Z',direction:'inbound',attachments:[{id:'attachment',filename:'file.pdf',size:5}]});
 assert.equal(m.attachments[0].downloadUrl,undefined);assert.equal(m.subject,'(No subject)');
});
test('cross-site API requests are rejected and same-origin navigation remains valid',()=>{
 assert.equal(sameOrigin(new Request('https://mail.example.com/api/status')),true);
 assert.equal(sameOrigin(new Request('https://mail.example.com/api/threads',{headers:{Origin:'https://evil.test'}})),false);
 assert.equal(sameOrigin(new Request('https://mail.example.com/api/threads',{headers:{'Sec-Fetch-Site':'cross-site'}})),false);
 assert.equal(sameOrigin(new Request('https://mail.example.com/api/threads',{headers:{Origin:'https://mail.example.com'}})),true);
 assert.equal(sameOrigin(new Request('https://mail.example.com/api/setup',{method:'POST'})),false);
});
