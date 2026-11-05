import 'server-only';
import type { Folder } from '@/lib/mail-types';
import { listThreads } from '@/lib/reader';
import { MailError } from '@/lib/mailboxes';
import { guard,json,failure } from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  try {
    await guard(request);
    const query=new URL(request.url).searchParams;
    const folder=query.get('folder') || 'inbox';
    if(!['inbox','sent','archive','spam','trash'].includes(folder))throw new MailError('Unknown folder.',400);
    const q=query.get('q')?.trim() || '';
    if(q.length>256 || q.split(/\s+/).length>32)throw new MailError('Use a shorter search (up to 256 characters and 32 words).',400);
    return json(await listThreads(query.get('inbox') || 'all',folder as Folder,q,query.get('cursor') || undefined));
  } catch(error){return failure(error);}
}
