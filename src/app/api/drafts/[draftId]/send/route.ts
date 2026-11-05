import 'server-only';
import { sendDraft } from '@/lib/drafts';
import { MailError } from '@/lib/mailboxes';
import { guard,json,failure,draftBody } from '@/lib/http';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{draftId:string}>}){try{const user=await guard(request);const body=await draftBody(request);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='reviewToken'))throw new MailError('Review the draft before sending.',400);return json(await sendDraft((await context.params).draftId,(body as {reviewToken?:unknown}).reviewToken,user.id));}catch(error){return failure(error);}}
