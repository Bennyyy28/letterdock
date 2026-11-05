import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import { appOrigin } from './auth';

const scrypt = promisify(nodeScrypt);
export const SESSION_SECONDS = 8 * 60 * 60;
export const SESSION_COOKIE = 'letterdock-session';
function passwordConfig() {
  const hash = process.env.LETTERDOCK_PASSWORD_HASH || '';
  const match = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(hash);
  if (!match) throw new Error('Configure authentication with npm run setup.');
  return {hash, salt:Buffer.from(match[1],'hex'), derived:Buffer.from(match[2],'hex')};
}
function signingKey() {
  const secret = process.env.LETTERDOCK_SESSION_SECRET || '';
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret) || Buffer.from(secret,'base64url').length < 32) throw new Error('Configure a random session secret with npm run setup.');
  return Buffer.from(secret,'base64url');
}
function revision() { return createHash('sha256').update(passwordConfig().hash).digest('hex'); }
export function authConfigured() { try {passwordConfig();signingKey();appOrigin();return true;} catch {return false;} }
export async function verifyPassword(password: unknown) {
  if (typeof password !== 'string' || password.length < 1 || password.length > 1024) return false;
  const cfg = passwordConfig();
  const derived = await scrypt(password,cfg.salt,64) as Buffer;
  return timingSafeEqual(derived,cfg.derived);
}
export async function createSession() {
  const now = Math.floor(Date.now()/1000);
  return new SignJWT({rev:revision()}).setProtectedHeader({alg:'HS256',typ:'JWT'})
    .setSubject('owner').setIssuer(appOrigin()).setAudience('letterdock')
    .setIssuedAt(now).setExpirationTime(now+SESSION_SECONDS).setJti(randomBytes(16).toString('hex')).sign(signingKey());
}
export async function verifySession(token: string | undefined): Promise<{id:string} | null> {
  if (!token || token.length > 2048) return null;
  try {
    const {payload} = await jwtVerify(token,signingKey(),{algorithms:['HS256'],issuer:appOrigin(),audience:'letterdock',maxTokenAge:SESSION_SECONDS});
    if (payload.sub !== 'owner' || payload.rev !== revision()) return null;
    return {id:`owner:${revision()}`};
  } catch { return null; }
}
export function sessionCookieOptions() {
  return {httpOnly:true,secure:appOrigin().startsWith('https:'),sameSite:'strict' as const,path:'/',maxAge:SESSION_SECONDS};
}
// Per-process backstop. Use edge/proxy limits too for internet-facing/multi-instance deployments.
let windowStart = 0, attempts = 0;
export function takeLoginAttempt(now = Date.now()): boolean {
  if (now-windowStart >= 5*60*1000) {windowStart=now;attempts=0;}
  if (attempts >= 10) return false;
  attempts++;return true;
}
