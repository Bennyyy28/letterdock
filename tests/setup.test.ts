import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('setup creates private auth configuration, refuses replacement, and rotates only authentication',()=>{
  const directory=mkdtempSync(join(tmpdir(),'letterdock-setup-test-'));
  try {
    const script=resolve('scripts/setup.mjs');
    const created=spawnSync(process.execPath,[script],{cwd:directory,encoding:'utf8'});
    assert.equal(created.status,0);assert.match(created.stdout,/Save this generated login password/);
    const path=join(directory,'.env.local'),initial=readFileSync(path,'utf8');
    assert.match(initial,/LETTERDOCK_PASSWORD_HASH=scrypt:[a-f0-9]{32}:[a-f0-9]{128}/);
    assert.match(initial,/LETTERDOCK_SESSION_SECRET=[A-Za-z0-9_-]{43}/);
    assert.equal((statSync(path).mode&0o777),0o600);
    assert.equal(spawnSync(process.execPath,[script],{cwd:directory}).status,1);
    assert.equal(readFileSync(path,'utf8'),initial);
    const configured=initial.replace('RESEND_API_KEY=','RESEND_API_KEY=synthetic-test-key');writeFileSync(path,configured);
    assert.equal(spawnSync(process.execPath,[script,'--rotate-auth'],{cwd:directory}).status,0);
    const rotated=readFileSync(path,'utf8');assert.notEqual(rotated,configured);
    assert.match(rotated,/RESEND_API_KEY=synthetic-test-key/);
    const withoutAuth=(s:string)=>s.replace(/^LETTERDOCK_(?:PASSWORD_HASH|SESSION_SECRET)=.*$/gm,'');
    assert.equal(withoutAuth(rotated),withoutAuth(configured));
  } finally {rmSync(directory,{recursive:true,force:true});}
});
