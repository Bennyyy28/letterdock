import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreadReadState } from '../src/components/thread-read-state';
import type { MailThread } from '../src/lib/mail-types';
const thread: MailThread = { id:'synthetic-thread', inboxId:'synthetic-inbox', inboxKey:'personal', subject:'Synthetic conversation', sender:'sender@example.com', preview:'Synthetic only', updatedAt:'2026-11-04T18:00:00Z', unread:true, messageCount:1, folder:'inbox' };

test('explicit unread open clears immediately and duplicate clicks do not create extra writes', () => {
  const reads = new ThreadReadState();
  const attempt = reads.begin(thread);
  assert.ok(attempt);
  assert.equal(reads.apply(thread).unread, false);
  assert.equal(reads.begin(thread), null);
  assert.equal(reads.begin({ ...thread, unread:false }), null);
  assert.equal(reads.complete(attempt), true);
  assert.equal(reads.begin(thread), null);
  assert.equal(thread.unread, true, 'raw provider data remains untouched for rollback');
});

test('an in-flight stale GET cannot resurrect unread before or after read confirmation', () => {
  const reads = new ThreadReadState();
  const inFlightResponse = { ...thread };
  const attempt = reads.begin(thread)!;
  assert.equal(reads.apply(inFlightResponse).unread, false);
  reads.complete(attempt);
  assert.equal(reads.apply(inFlightResponse).unread, false);
  assert.equal(reads.apply({ ...thread, unread:false }).unread, false);
  assert.equal(reads.apply(inFlightResponse).unread, false, 'a later stale result still cannot undo the same-version read');
});

test('a genuinely newer message can be unread while an older read is pending or confirmed', () => {
  const reads = new ThreadReadState();
  const attempt = reads.begin(thread)!;
  const moreMessages = { ...thread, messageCount:2 };
  const newerTimestamp = { ...thread, updatedAt:'2026-11-04T18:01:00Z' };
  assert.equal(reads.apply(moreMessages).unread, true);
  reads.complete(attempt);
  assert.equal(reads.apply(moreMessages).unread, true);
  assert.equal(reads.apply(newerTimestamp).unread, true);
  assert.equal(reads.apply({ ...moreMessages, unread:false }).unread, false);
});

test('failed saves roll back unread counts and allow an explicit retry', () => {
  const reads = new ThreadReadState();
  const list = [thread, { ...thread, id:'other', unread:false }];
  const attempt = reads.begin(thread)!;
  assert.equal(list.map(item => reads.apply(item)).filter(item => item.unread).length, 0);
  assert.equal(reads.fail(attempt), true);
  assert.equal(list.map(item => reads.apply(item)).filter(item => item.unread).length, 1);
  assert.deepEqual(reads.failures(), [thread]);
  const retry = reads.begin(thread)!;
  assert.ok(retry);
  assert.deepEqual(reads.failures(), []);
  reads.complete(retry);
  assert.equal(reads.apply(thread).unread, false);
});

test('superseded completions and failures cannot change a newer explicit open', () => {
  const reads = new ThreadReadState();
  const old = reads.begin(thread)!;
  const newer = { ...thread, messageCount:2, updatedAt:'2026-11-04T18:01:00Z' };
  const current = reads.begin(newer)!;
  assert.notEqual(current.token, old.token);
  assert.equal(reads.fail(old), false);
  assert.equal(reads.apply(newer).unread, false);
  reads.fail(current);
  assert.equal(reads.complete(old), false);
  assert.equal(reads.apply(newer).unread, true);
  assert.deepEqual(reads.failures(), [newer]);
});

test('read state is scoped to the fixed inbox plus thread ID', () => {
  const reads = new ThreadReadState();
  const attempt = reads.begin(thread)!;
  reads.complete(attempt);
  assert.equal(reads.apply({ ...thread, inboxKey:'agents' }).unread, true);
  assert.equal(reads.apply({ ...thread, inboxKey:'assistant' }).unread, true);
  assert.ok(reads.begin({ ...thread, inboxKey:'assistant' }));
});

test('confirmed mark unread supersedes saved read state and stale read completions', () => {
  const reads = new ThreadReadState();
  const old = reads.begin(thread)!;
  reads.markUnread(thread);
  assert.equal(reads.complete(old), false);
  assert.equal(reads.fail(old), false);
  assert.equal(reads.apply({ ...thread, unread:false }).unread, true);
  assert.deepEqual(reads.failures(), []);
  const reopened = reads.begin(reads.apply({ ...thread, unread:false }));
  assert.ok(reopened, 'an explicit reopen writes read again for the same message version');
  assert.equal(reads.apply(thread).unread, false);
  reads.complete(reopened);
  assert.equal(reads.apply(thread).unread, false);
});

test('mark unread removes a failed read retry and affects only its fixed inbox', () => {
  const reads = new ThreadReadState();
  reads.fail(reads.begin(thread)!);
  reads.markUnread(thread);
  assert.deepEqual(reads.failures(), []);
  assert.equal(reads.apply({ ...thread, unread:false }).unread, true);
  assert.equal(reads.apply({ ...thread, unread:false, inboxKey:'agents' }).unread, false);
});
