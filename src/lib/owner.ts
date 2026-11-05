import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from './session';
export async function getOwner() { return verifySession((await cookies()).get(SESSION_COOKIE)?.value); }
export async function requireOwner() { const owner=await getOwner();if(!owner)redirect('/login');return owner; }
