import 'server-only';
import { getThread } from '@/lib/reader';
import { guard,json,failure } from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{inboxKey:string;threadId:string}>}) {
  try {await guard(request);const p=await context.params;return json(await getThread(p.inboxKey,p.threadId));}catch(error){return failure(error);}
}
