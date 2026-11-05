import 'server-only';
import { cookies } from 'next/headers';
import { sameOrigin } from '@/lib/auth';
import { authConfigured, createSession, SESSION_COOKIE, sessionCookieOptions, takeLoginAttempt, verifyPassword } from '@/lib/session';
import { json, failure } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function POST(request:Request) {
  if (!sameOrigin(request)) return json({error:'Request not allowed.'},403);
  if (!authConfigured()) return json({error:'Authentication is not configured. Run npm run setup on the server.'},503);
  if (!takeLoginAttempt()) return json({error:'Too many attempts. Try again in five minutes.'},429,{'Retry-After':'300'});
  try {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||'')) return json({error:'Use a JSON sign-in request.'},415);
    const reader=request.body?.getReader();if(!reader)return json({error:'Enter your password.'},400);
    let text='';const decoder=new TextDecoder();let length=0;
    try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>4096){await reader.cancel();return json({error:'Request too large.'},413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
    let data:unknown;try{data=JSON.parse(text);}catch{return json({error:'Invalid request.'},400);}
    if (!data || typeof data!=='object' || Array.isArray(data) || Object.keys(data).length!==1 || !('password' in data) || !await verifyPassword(data.password)) return json({error:'Incorrect password.'},401);
    (await cookies()).set(SESSION_COOKIE,await createSession(),sessionCookieOptions());
    return json({signedIn:true});
  } catch(error) {return failure(error);}
}
