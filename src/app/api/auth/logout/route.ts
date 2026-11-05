import 'server-only';
import { cookies } from 'next/headers';
import { appOrigin, sameOrigin } from '@/lib/auth';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';
export async function POST(request:Request) {
  if(!sameOrigin(request))return Response.json({error:'Request not allowed.'},{status:403});
  (await cookies()).set(SESSION_COOKIE,'',{...sessionCookieOptions(),maxAge:0});
  return Response.redirect(new URL('/login',appOrigin()),303);
}
