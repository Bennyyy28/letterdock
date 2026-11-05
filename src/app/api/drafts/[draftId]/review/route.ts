import 'server-only';
import { reviewDraft } from '@/lib/drafts';
import { MailError } from '@/lib/mailboxes';
import { guard,json,failure,draftBody } from '@/lib/http';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{draftId:string}>}){try{const user=await guard(request);return json(await reviewDraft((await context.params).draftId,user.id));}catch(error){return failure(error);}}
