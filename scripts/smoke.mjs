// Production HTTP integration check. Every provider request is intercepted by a test preload.
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let checks=0;
function check(value,message){assert.ok(value,message);checks++;}
async function freePort(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function run(enabled){
  const port=await freePort(),origin=`http://127.0.0.1:${port}`;
  const password=randomBytes(24).toString('base64url'),salt=randomBytes(16);
  const child=spawn(process.execPath,['--import',resolve('tests/provider-fixture.mjs'),'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{
    cwd:process.cwd(),stdio:['ignore','pipe','pipe'],env:{...process.env,
      NEXT_TELEMETRY_DISABLED:'1',NODE_ENV:'production',
      LETTERDOCK_ORIGIN:origin,
      LETTERDOCK_PASSWORD_HASH:`scrypt:${salt.toString('hex')}:${scryptSync(password,salt,64).toString('hex')}`,
      LETTERDOCK_SESSION_SECRET:randomBytes(32).toString('base64url'),
      LETTERDOCK_OWNER_NAME:'Demo workspace',
      LETTERDOCK_SENDING_INBOX:enabled?'personal':'',RESEND_API_KEY:'synthetic-test-key',
      RESEND_INBOXES:JSON.stringify([{key:'personal',id:id(1),name:'Personal',address:'you@example.com'}]),
    },
  });
  // Do not echo server logs or generated authentication values to CI.
  child.stdout.resume();child.stderr.resume();
  const exited=once(child,'exit');
  async function request(path,{method='GET',body,cookie,originHeader=origin,headers={}}={}){
    return fetch(origin+path,{method,redirect:'manual',headers:{...(originHeader?{Origin:originHeader}:{}),...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  }
  try{
    let ready=false;
    for(let n=0;n<100;n++){
      if(child.exitCode!==null)throw new Error('The test server exited before becoming ready.');
      try{if((await request('/login')).status===200){ready=true;break;}}catch{}
      await delay(100);
    }
    check(ready,'Production server started');
    const home=await request('/');check(home.status===307&&home.headers.get('location')==='/login','Unauthenticated UI redirects to login');
    const paths=['/api/status','/api/threads','/api/threads/personal/'+id(11),'/api/drafts','/api/drafts/'+id(21)];
    for(const path of paths){check((await request(path)).status===401,'Mail GET requires authentication');check((await request(path,{cookie:'letterdock-session=forged'})).status===401,'Forged cookie is rejected');}
    for(const path of ['/api/drafts',`/api/drafts/${id(21)}/review`,`/api/drafts/${id(21)}/send`,`/api/threads/personal/${id(11)}/read`,`/api/threads/personal/${id(11)}/manage`])check((await request(path,{method:'POST',body:{}})).status===401,'Mail POST requires authentication');
    check((await request('/api/auth/login',{method:'POST',body:{password},originHeader:'https://evil.example'})).status===403,'Cross-site login fails');
    check((await request('/api/auth/login',{method:'POST',body:{password},originHeader:null})).status===403,'Originless login fails');
    check((await request('/api/auth/login',{method:'POST',body:{password:'wrong'}})).status===401,'Wrong password fails');
    check((await request('/api/auth/login',{method:'POST',body:{password:'x'.repeat(5000)}})).status===413,'Login request size is bounded');
    const login=await request('/api/auth/login',{method:'POST',body:{password}});
    check(login.status===200,'Configured password signs in');
    const header=login.headers.get('set-cookie')||'';
    check(/HttpOnly/i.test(header)&&/SameSite=strict/i.test(header)&&/Max-Age=28800/i.test(header),'Session cookie protections');
    const cookie=header.split(';')[0];
    const status=await request('/api/status',{cookie});check(status.status===200,'Authenticated status is available');
    check(/no-store/.test(status.headers.get('cache-control')||''),'Mail status is not cached');
    const connection=await status.json();check(connection.sendingEnabled===enabled,'Sending follows explicit server configuration');
    check(!JSON.stringify(connection).includes('synthetic-test-key')&&!('id'in connection.mailboxes[0]),'Status exposes no key or provider inbox ID');
    const list=await request('/api/threads',{cookie});check(list.status===200&&(await list.json()).threads.length===1,'Authenticated mail uses synthetic provider fixture');
    check((await request('/api/threads',{cookie,originHeader:'https://evil.example'})).status===403,'Authenticated cross-origin requests fail');
    check((await request(`/api/threads/personal/${id(11)}/manage`,{method:'POST',cookie,body:{action:'archive'},originHeader:null})).status===403,'Originless mail write fails');
    check((await request('/api/drafts',{method:'POST',cookie,body:{requestId:id(31),from:'other@example.com',text:'Synthetic'}})).status===400,'Caller-selected sender is rejected');
    if(enabled){
      const managed=await request(`/api/threads/personal/${id(11)}/manage`,{method:'POST',cookie,body:{action:'archive'}});check(managed.status===200,'Explicit archive writes through the synthetic provider');
      const draft=await request('/api/drafts',{method:'POST',cookie,body:{requestId:id(31),to:['recipient@example.com'],subject:'Synthetic release check',text:'Only a fixture. No email is sent.'}});check(draft.status===201,'Explicit draft creation works');
      check((await request(`/api/drafts/${id(21)}/send`,{method:'POST',cookie,body:{reviewToken:'forged'}})).status===409,'Unreviewed sends are rejected');
      const review=await request(`/api/drafts/${id(21)}/review`,{method:'POST',cookie});check(review.status===200,'Saved draft can be reviewed');
      const approval=await review.json();
      const sent=await request(`/api/drafts/${id(21)}/send`,{method:'POST',cookie,body:{reviewToken:approval.reviewToken}});check(sent.status===200&&(await sent.json()).sent===true,'Reviewed explicit send reaches only the mocked provider');
    }else{
      for(const [path,method,body]of [['/api/drafts','GET',undefined],['/api/drafts','POST',{requestId:id(31),subject:'Synthetic',text:'Synthetic'}],[`/api/drafts/${id(21)}/review`,'POST',undefined],[`/api/drafts/${id(21)}/send`,'POST',{reviewToken:'forged'}]])check((await request(path,{method,cookie,body})).status===403,'Disabled draft/send routes fail closed');
    }
    check((await request('/api/auth/logout',{method:'POST',cookie,originHeader:'https://evil.example'})).status===403,'Cross-site logout fails');
    const logout=await request('/api/auth/logout',{method:'POST',cookie});check(logout.status===303&&/Max-Age=0/.test(logout.headers.get('set-cookie')||''),'Logout clears the browser cookie');
  }finally{
    child.kill('SIGTERM');await Promise.race([exited,delay(3000)]);
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}
  }
}
await run(false);await run(true);
console.log(`Production smoke passed: ${checks} checks; all provider responses synthetic, no real mail or keys used.`);
