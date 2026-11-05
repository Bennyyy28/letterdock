import test from 'node:test';
import assert from 'node:assert/strict';
import { availableThreadActions, confirmsThreadAction, ThreadActionState } from '../src/components/thread-action-state';
import { ThreadReadState } from '../src/components/thread-read-state';
import type { MailThread } from '../src/lib/mail-types';

const thread: MailThread = { id:'synthetic-thread', inboxId:'synthetic-inbox', inboxKey:'personal', subject:'Synthetic conversation', sender:'sender@example.com', preview:'Synthetic only', updatedAt:'2026-11-04T18:00:00Z', unread:true, messageCount:1, folder:'inbox' };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('a pending or failed move retains the row and can be retried', () => {
  const actions = new ThreadActionState();
  const pending = actions.begin(thread, 'trash')!;
  assert.equal(actions.pendingAction(thread), 'trash');
  assert.equal(actions.begin(thread, 'archive'), null, 'duplicate writes are disabled for that conversation');
  assert.equal(actions.apply(thread).folder, 'inbox');
  assert.equal(actions.fail(pending), true);
  assert.equal(actions.pendingAction(thread), undefined);
  assert.equal(actions.apply(thread).folder, 'inbox');
  assert.deepEqual(actions.failures(), [pending]);
  const retry = actions.begin(thread, 'trash')!;
  assert.deepEqual(actions.failures(), []);
  assert.equal(actions.complete(retry), true);
  assert.equal(actions.apply(thread).folder, 'trash');
  assert.equal(thread.folder, 'inbox', 'the raw provider snapshot is never mutated');
});

test('late GETs cannot resurrect a moved row or replace a later move to inbox', () => {
  const actions = new ThreadActionState();
  const staleInboxResponse = { ...thread };
  actions.complete(actions.begin(thread, 'archive')!);
  assert.equal([staleInboxResponse].map(item => actions.apply(item)).filter(item => item.folder === 'inbox').length, 0);
  assert.equal(actions.apply(staleInboxResponse).folder, 'archive');
  const back = actions.begin(actions.apply(thread), 'inbox')!;
  actions.complete(back);
  assert.equal(actions.apply({ ...thread, folder:'archive' }).folder, 'inbox');
  assert.equal(actions.apply(staleInboxResponse).folder, 'inbox');
  assert.equal(actions.fail(back), false, 'a settled write cannot reappear as an error');
});

test('folder state and pending writes are scoped to inbox plus thread ID across navigation', () => {
  const actions = new ThreadActionState();
  const otherInbox = { ...thread, inboxKey:'agents' as const };
  const oldViewWrite = actions.begin(thread, 'trash')!;
  assert.equal(actions.pendingAction(otherInbox), undefined);
  actions.complete(oldViewWrite);
  const otherInboxView = [otherInbox].map(item => actions.apply(item)).filter(item => item.inboxKey === 'agents' && item.folder === 'inbox');
  assert.deepEqual(otherInboxView, [otherInbox]);
  assert.equal(actions.apply(thread).folder, 'trash');
});

test('a genuinely newer incoming message is not hidden by an older folder snapshot', () => {
  const actions = new ThreadActionState();
  actions.complete(actions.begin(thread, 'archive')!);
  assert.equal(actions.apply({ ...thread, messageCount:2, updatedAt:'2026-11-04T18:01:00Z' }).folder, 'inbox');
});

test('pending read-on-open finishes before mark unread, and explicit reopening can mark read again', async () => {
  const actions = new ThreadActionState();
  const reads = new ThreadReadState();
  const events: string[] = [];
  const gate = deferred();
  const open = reads.begin(thread)!;
  const reading = actions.enqueue(thread, async () => { events.push('read:start'); await gate.promise; reads.complete(open); events.push('read:saved'); });
  const unread = actions.begin(reads.apply(thread), 'unread')!;
  const marking = actions.enqueue(thread, async () => { events.push('unread:start'); actions.complete(unread); reads.markUnread(thread); events.push('unread:saved'); });
  await Promise.resolve();
  assert.deepEqual(events, ['read:start']);
  assert.equal(reads.apply(thread).unread, false, 'unread waits for confirmed provider success');
  gate.resolve();
  await Promise.all([reading, marking]);
  assert.deepEqual(events, ['read:start', 'read:saved', 'unread:start', 'unread:saved']);
  assert.equal(reads.apply({ ...thread, unread:false }).unread, true, 'a stale read GET cannot undo explicit unread');
  assert.equal(reads.complete(open), false, 'the old read overlay was superseded');
  const reopen = reads.begin(reads.apply({ ...thread, unread:false }))!;
  assert.ok(reopen);
  await actions.enqueue(thread, async () => { events.push('reopen:read'); reads.complete(reopen); });
  assert.equal(reads.apply(thread).unread, false);
  assert.equal(events.at(-1), 'reopen:read');
});

test('a rejected write does not block a queued retry or another fixed inbox', async () => {
  const actions = new ThreadActionState();
  const gate = deferred();
  const events: string[] = [];
  const first = actions.enqueue(thread, async () => { await gate.promise; events.push('failed'); throw new Error('Synthetic failure'); });
  const rejected = assert.rejects(first, /Synthetic failure/);
  const retry = actions.enqueue(thread, async () => { events.push('retry'); });
  await actions.enqueue({ ...thread, inboxKey:'assistant' }, async () => { events.push('assistant'); });
  assert.deepEqual(events, ['assistant']);
  gate.resolve();
  await Promise.all([rejected, retry]);
  assert.deepEqual(events, ['assistant', 'failed', 'retry']);
});

test('success requires the matching conversation and the requested change', () => {
  assert.equal(confirmsThreadAction({ id:thread.id, folder:'archive' }, thread, 'archive'), true);
  assert.equal(confirmsThreadAction({ id:thread.id, read:false }, thread, 'unread'), true);
  for (const body of [null, {}, { id:'other', folder:'archive' }, { id:thread.id, folder:'trash' }, { id:thread.id, error:'Synthetic failure' }]) {
    assert.equal(confirmsThreadAction(body, thread, 'archive'), false);
  }
  assert.equal(confirmsThreadAction({ id:thread.id, read:true }, thread, 'unread'), false);
});

test('Archive and Trash offer a route back to inbox and Trash never offers repeat deletion', () => {
  assert.deepEqual(availableThreadActions('inbox'), ['archive', 'unread', 'trash']);
  assert.deepEqual(availableThreadActions('archive'), ['inbox', 'unread', 'trash']);
  assert.deepEqual(availableThreadActions('trash'), ['inbox', 'unread']);
});
