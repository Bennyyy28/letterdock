import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMailboxes, sendingMailbox } from '../src/lib/mailboxes';
import { createDraft, listDrafts, reviewDraft, sendDraft } from '../src/lib/drafts';
const box={key:'work',id:'00000000-0000-4000-8000-000000000001',name:'Work',address:'you@example.com'};
test('mailboxes are operator-configured, bounded, unique, and never default to real accounts',()=>{
  assert.deepEqual(parseMailboxes(undefined),[]);
  assert.deepEqual(parseMailboxes('[]'),[]);
  assert.deepEqual(parseMailboxes(JSON.stringify([box])),[{...box,description:''}]);
  for(const invalid of ['{','{}','a'.repeat(20001),JSON.stringify(Array(11).fill(box))]) assert.throws(()=>parseMailboxes(invalid));
  for(const replacement of [{key:'all'},{key:'__proto__'},{key:'constructor'},{key:'../escape'},{id:'../escape'},{name:''},{address:'a@example.com\r\nBcc: other@example.com'},{address:'not-an-address'},{description:'a'.repeat(161)},{other:'unexpected'}]) assert.throws(()=>parseMailboxes(JSON.stringify([{...box,...replacement}])));
  for(const second of [{...box,id:'00000000-0000-4000-8000-000000000002',address:'other@example.com'},{...box,key:'other',address:'other@example.com'},{...box,key:'other',id:'00000000-0000-4000-8000-000000000002',address:'YOU@example.com'}]) assert.throws(()=>parseMailboxes(JSON.stringify([box,second])));
});
test('disabled sending blocks draft creation, listing, review and send before any network request',async()=>{
  const saved = { sender: process.env.LETTERDOCK_SENDING_INBOX, provider: process.env.RESEND_API_KEY, fetch: globalThis.fetch };
  delete process.env.LETTERDOCK_SENDING_INBOX;process.env.RESEND_API_KEY='synthetic-test-key';let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('Unexpected provider call');};
  try {
    assert.throws(()=>sendingMailbox(),/disabled/);
    await assert.rejects(()=>listDrafts(),/disabled/);
    await assert.rejects(()=>createDraft({requestId:box.id,to:['recipient@example.com'],text:'Synthetic',subject:'Synthetic'}),/disabled/);
    await assert.rejects(()=>reviewDraft(box.id,'synthetic-owner'),/disabled/);
    await assert.rejects(()=>sendDraft(box.id,'fake-token','synthetic-owner'),/disabled/);
    assert.equal(calls,0);
    process.env.LETTERDOCK_SENDING_INBOX='unconfigured';assert.throws(()=>sendingMailbox(),/Unknown inbox/);
  } finally {
    if(saved.sender===undefined)delete process.env.LETTERDOCK_SENDING_INBOX;else process.env.LETTERDOCK_SENDING_INBOX=saved.sender;
    if(saved.provider===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=saved.provider;
    globalThis.fetch=saved.fetch;
  }
});
