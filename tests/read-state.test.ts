import test from 'node:test';
import assert from 'node:assert/strict';
import { markThreadRead, requireEmptyReadBody } from '../src/lib/read-state';
import { getThread } from '../src/lib/reader';
import { MAILBOXES, MailError } from '../src/lib/mailboxes';

const id = '00000000-0000-4000-8000-000000000001';
test('read state writes only read=true to fixed inboxes and requires an exact provider acknowledgement', async () => {
  const originalFetch = globalThis.fetch, originalKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'synthetic-key';
  const calls: {url: string; options?: RequestInit}[] = [];
  globalThis.fetch = async (input, options) => { calls.push({url:String(input),options}); return Response.json({id,read:true}); };
  try {
    for (const box of MAILBOXES) {
      assert.deepEqual(await markThreadRead(box.key,id), {read:true});
      const call = calls.at(-1)!;
      assert.equal(call.url, `https://api.resend.com/inboxes/${box.id}/threads/${id}`);
      assert.equal(call.options?.method,'PATCH');
      assert.deepEqual(JSON.parse(String(call.options?.body)),{read:true});
      assert.equal(call.options?.cache,'no-store');
      assert.equal(call.options?.redirect,'manual');
    }
    const count = calls.length;
    await assert.rejects(markThreadRead('all',id));
    await assert.rejects(markThreadRead('https://evil.test',id));
    await assert.rejects(markThreadRead('personal','../escape'));
    assert.equal(calls.length,count);
    for (const result of [{id,read:false},{id:'wrong',read:true},null]) {
      globalThis.fetch = async () => Response.json(result);
      await assert.rejects(markThreadRead('personal',id), /did not confirm/);
    }
    globalThis.fetch = async () => new Response('not JSON');
    await assert.rejects(markThreadRead('personal',id), /did not confirm/);
  } finally { globalThis.fetch=originalFetch; if(originalKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=originalKey; }
});

test('read status failures remain failures and passive conversation GETs never mark mail read', async () => {
  const originalFetch=globalThis.fetch, originalKey=process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY='synthetic-key';
  try {
    for (const [upstream,expected] of [[401,503],[403,503],[404,404],[429,429],[500,502],[302,502]]) {
      let calls=0;
      globalThis.fetch=async()=>{calls++;return new Response(null,{status:upstream});};
      await assert.rejects(markThreadRead('assistant',id),(error:unknown)=>error instanceof MailError&&error.status===expected);
      assert.equal(calls,1);
    }
    globalThis.fetch=async()=>{throw new Error('synthetic network failure');};
    await assert.rejects(markThreadRead('personal',id),/could not be saved/);
    const methods:string[]=[];
    globalThis.fetch=async(input,options)=>{methods.push(options?.method||'GET');return Response.json(String(input).includes('/emails?')?{data:[],has_more:false}:{id,subject:'Synthetic',read:false,folder:'inbox'});};
    const conversation=await getThread('agents',id);
    assert.equal(conversation.thread.unread,true);
    assert.deepEqual(methods,['GET','GET']);
  } finally { globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=originalKey; }
});

test('read route accepts bodyless and empty-stream POSTs but rejects body bytes without buffering them', async () => {
  const url = 'https://mail.example.com/api/threads/agents/00000000-0000-4000-8000-000000000001/read';
  await requireEmptyReadBody(new Request(url, {method:'POST'}));
  await requireEmptyReadBody(new Request(url, {method:'POST', body:''}));
  const empty = new ReadableStream<Uint8Array>({start(controller) {
    controller.enqueue(new Uint8Array());
    controller.close();
  }});
  await requireEmptyReadBody(new Request(url, {method:'POST', body:empty, duplex:'half'} as RequestInit));
  for (const body of ['{}', ' ']) {
    await assert.rejects(requireEmptyReadBody(new Request(url, {method:'POST', body})),
      (error:unknown) => error instanceof MailError && error.status === 400);
  }
  let canceled = false;
  const nonempty = new ReadableStream<Uint8Array>({start(controller) {
    controller.enqueue(new Uint8Array());
    controller.enqueue(new Uint8Array([1]));
  }, cancel() { canceled = true; }});
  await assert.rejects(requireEmptyReadBody(new Request(url, {
    method:'POST', headers:{'Content-Length':'0'}, body:nonempty, duplex:'half',
  } as RequestInit)), (error:unknown) => error instanceof MailError && error.status === 400);
  assert.equal(canceled, true);
});
