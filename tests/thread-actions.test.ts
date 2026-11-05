import test from 'node:test';
import assert from 'node:assert/strict';
import { manageThread, parseThreadAction, threadActionBody } from '../src/lib/thread-actions';
import { MAILBOXES, MailError } from '../src/lib/mailboxes';
import type { ThreadAction } from '../src/lib/mail-types';

const id = '00000000-0000-4000-8000-000000000001';
const isStatus = (status: number) => (error: unknown) => error instanceof MailError && error.status === status;

test('inbox actions strictly allow one explicit action and bound streamed JSON before provider writes', async () => {
  for (const action of ['archive', 'trash', 'unread', 'inbox']) {
    assert.equal(parseThreadAction({action}), action);
    assert.equal(await threadActionBody(new Request('https://mail.example.com/api/manage', {
      method:'POST', headers:{'Content-Type':'application/json; charset=utf-8'}, body:JSON.stringify({action}),
    })), action);
  }
  for (const value of [null, [], {}, 'archive', {action:'delete'}, {action:'sent'}, {action:'read'}, {action:true},
    {action:'archive',read:true}, {action:'trash',folder:'inbox'}, {action:'unread',inboxId:'caller-selected'},
    {action:'archive',from:'sender@example.com'}, {folder:'trash'}, {read:false}, Object.create({action:'archive'})]) {
    assert.throws(() => parseThreadAction(value), isStatus(400));
  }
  const url = 'https://mail.example.com/api/manage';
  await assert.rejects(threadActionBody(new Request(url,{method:'POST',body:'{"action":"archive"}'})),isStatus(415));
  await assert.rejects(threadActionBody(new Request(url,{method:'POST',headers:{'Content-Type':'application/json-patch+json'},body:'{}'})),isStatus(415));
  for (const body of [undefined,'','not-json','null','{}','{"action":"unread","read":false}']) {
    await assert.rejects(threadActionBody(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body})),isStatus(400));
  }
  await assert.rejects(threadActionBody(new Request(url,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':'1025'},body:'{}'})),isStatus(413));
  let canceled = false;
  const oversized = new ReadableStream<Uint8Array>({start(controller) {controller.enqueue(new Uint8Array(1025));},cancel() {canceled=true;}});
  await assert.rejects(threadActionBody(new Request(url,{
    method:'POST', headers:{'Content-Type':'application/json','Content-Length':'0'},body:oversized,duplex:'half',
  } as RequestInit)),isStatus(413));
  assert.equal(canceled,true);
  const chunks = new ReadableStream<Uint8Array>({start(controller) {
    controller.enqueue(new TextEncoder().encode('{"act'));
    controller.enqueue(new TextEncoder().encode('ion":"unread"}'));
    controller.close();
  }});
  assert.equal(await threadActionBody(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:chunks,duplex:'half'} as RequestInit)),'unread');
});

test('archive, reversible trash, unread, and restore PATCH only the intended field in each fixed inbox', async () => {
  const originalFetch=globalThis.fetch, originalKey=process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY='synthetic-key';
  const calls:{url:string;options?:RequestInit}[]=[];
  globalThis.fetch=async(input,options)=>{
    calls.push({url:String(input),options});
    return Response.json({id,...JSON.parse(String(options?.body))});
  };
  try {
    for (const box of MAILBOXES) for (const action of ['archive','trash','unread','inbox'] as const) {
      const patch = action==='unread'?{read:false}:{folder:action};
      assert.deepEqual(await manageThread(box.key,id,action),{id,...patch});
      const call=calls.at(-1)!;
      assert.equal(call.url,`https://api.resend.com/inboxes/${box.id}/threads/${id}`);
      assert.equal(call.options?.method,'PATCH');
      assert.deepEqual(JSON.parse(String(call.options?.body)),patch);
      assert.equal(call.options?.redirect,'manual');
      assert.equal(call.options?.cache,'no-store');
      assert.equal(Object.keys(patch).length,1,'do not combine non-atomic read and folder changes');
    }
    const count=calls.length;
    await assert.rejects(manageThread('all',id,'archive'),isStatus(400));
    await assert.rejects(manageThread('caller-selected',id,'trash'),isStatus(400));
    await assert.rejects(manageThread('personal','../escape','unread'),isStatus(400));
    await assert.rejects(manageThread('agents',id,'delete' as ThreadAction),isStatus(400));
    delete process.env.RESEND_API_KEY;
    await assert.rejects(manageThread('assistant',id,'archive'),isStatus(503));
    assert.equal(calls.length,count);
  } finally {globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=originalKey;}
});

test('inbox action failures and mismatched provider acknowledgements never report success or retry automatically', async () => {
  const originalFetch=globalThis.fetch, originalKey=process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY='synthetic-key';
  try {
    for (const [upstream,expected] of [[401,503],[403,503],[404,404],[429,429],[500,502],[302,502]]) {
      let calls=0;
      globalThis.fetch=async()=>{calls++;return new Response(null,{status:upstream});};
      await assert.rejects(manageThread('personal',id,'trash'),isStatus(expected));
      assert.equal(calls,1);
    }
    for (const [action,result] of [
      ['unread',{id,read:true}], ['unread',{id,folder:'inbox'}], ['unread',{id:'different',read:false}],
      ['archive',{id,folder:'inbox'}], ['trash',{id,folder:'archive'}], ['inbox',{id:'different',folder:'inbox'}], ['trash',null],
    ] as const) {
      globalThis.fetch=async()=>Response.json(result);
      await assert.rejects(manageThread('agents',id,action),/did not confirm/);
    }
    globalThis.fetch=async()=>new Response('invalid JSON');
    await assert.rejects(manageThread('assistant',id,'unread'),/did not confirm/);
    globalThis.fetch=async()=>{throw new Error('synthetic network failure');};
    await assert.rejects(manageThread('assistant',id,'archive'),/could not be saved/);
  } finally {globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=originalKey;}
});
