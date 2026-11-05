import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { SignJWT } from 'jose';
import { appOrigin, sameOrigin } from '../src/lib/auth';
import { authConfigured, createSession, sessionCookieOptions, SESSION_SECONDS, takeLoginAttempt, verifyPassword, verifySession } from '../src/lib/session';

function configure() {
  const password = 'synthetic-password-for-unit-tests';
  const salt = randomBytes(16);
  process.env.LETTERDOCK_PASSWORD_HASH = `scrypt:${salt.toString('hex')}:${scryptSync(password,salt,64).toString('hex')}`;
  process.env.LETTERDOCK_SESSION_SECRET = randomBytes(32).toString('base64url');
  process.env.LETTERDOCK_ORIGIN = 'https://mail.example.com';
  return password;
}
test('authentication fails closed without valid operator configuration',()=>{
  configure(); assert.equal(authConfigured(),true);
  const hash = process.env.LETTERDOCK_PASSWORD_HASH;
  delete process.env.LETTERDOCK_PASSWORD_HASH; assert.equal(authConfigured(),false);
  process.env.LETTERDOCK_PASSWORD_HASH=hash;
  process.env.LETTERDOCK_SESSION_SECRET='short'; assert.equal(authConfigured(),false);
  configure(); process.env.LETTERDOCK_ORIGIN='http://mail.example.com'; assert.equal(authConfigured(),false);
});
test('password verification is bounded and signed sessions reject forged, expired, and wrong-issuer tokens',async()=>{
  const password=configure();
  assert.equal(await verifyPassword(password),true);
  for(const bad of ['', 'incorrect', 'a'.repeat(1025), undefined, {}, 42]) assert.equal(await verifyPassword(bad),false);
  const token=await createSession(); assert.ok((await verifySession(token))?.id.startsWith('owner:'));
  const unsigned=[Buffer.from(JSON.stringify({alg:'none'})).toString('base64url'),Buffer.from(JSON.stringify({sub:'owner'})).toString('base64url'),''].join('.');
  for(const bad of [undefined,'','a'.repeat(2049),token+'tampered',unsigned]) assert.equal(await verifySession(bad),null);
  const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
  const key=Buffer.from(process.env.LETTERDOCK_SESSION_SECRET!,'base64url');
  for(const overrides of [{exp:1},{sub:'another-owner'},{iss:'https://evil.example'},{aud:'other-app'},{iat:Math.floor(Date.now()/1000)-SESSION_SECONDS-1,exp:Math.floor(Date.now()/1000)+60}]) {
    const invalid=await new SignJWT({...payload,...overrides}).setProtectedHeader({alg:'HS256'}).sign(key);
    assert.equal(await verifySession(invalid),null);
  }
});
test('password or signing-secret rotation invalidates existing sessions',async()=>{
  configure();const token=await createSession();
  const secret=process.env.LETTERDOCK_SESSION_SECRET;configure();process.env.LETTERDOCK_SESSION_SECRET=secret;
  assert.equal(await verifySession(token),null);
  const fresh=await createSession(); process.env.LETTERDOCK_SESSION_SECRET=randomBytes(32).toString('base64url');
  assert.equal(await verifySession(fresh),null);
});
test('cookies stay HttpOnly, SameSite Strict, and Secure on HTTPS',()=>{
  configure();assert.deepEqual(sessionCookieOptions(),{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:28800});
  process.env.LETTERDOCK_ORIGIN='http://localhost:3000';assert.equal(sessionCookieOptions().secure,false);
});
test('CSRF checks use the configured origin and reject missing origins on writes and spoofed hosts',()=>{
  configure();const url='https://mail.example.com/api/drafts';
  assert.equal(sameOrigin(new Request(url)),true);
  assert.equal(sameOrigin(new Request(url,{method:'POST',headers:{Origin:'https://mail.example.com'}})),true);
  for(const headers of [{},{Origin:'null'},{Origin:'https://mail.example.com.evil.test'},{Origin:'https://mail.example.com/path'},{Origin:'https://evil.test',Host:'mail.example.com','X-Forwarded-Host':'mail.example.com'},{Origin:'https://mail.example.com','Sec-Fetch-Site':'cross-site'}] as Record<string,string>[]) {
    assert.equal(sameOrigin(new Request(url,{method:'POST',headers})),false);
  }
  for(const bad of ['http://example.com','https://user:pass@example.com','https://mail.example.com/subpath','https://mail.example.com?query','file:///tmp','https://mail.example.com#fragment']) {
    process.env.LETTERDOCK_ORIGIN=bad;assert.throws(()=>appOrigin());assert.equal(sameOrigin(new Request(url)),false);
  }
});
test('login hashing has a process-level attempt limit and recovers after its window',()=>{
  const start=Date.now()+600000;
  for(let i=0;i<10;i++)assert.equal(takeLoginAttempt(start+i),true);
  assert.equal(takeLoginAttempt(start+11),false);
  assert.equal(takeLoginAttempt(start+300000),true);
});
