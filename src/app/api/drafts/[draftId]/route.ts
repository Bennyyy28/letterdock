import 'server-only';
import { getDraft,updateDraft } from '@/lib/drafts';
import { guard,json,failure,draftBody } from '@/lib/http';
export const dynamic='force-dynamic';
type Context={params:Promise<{draftId:string}>};
export async function GET(request:Request,context:Context){try{await guard(request);return json({draft:await getDraft((await context.params).draftId)});}catch(error){return failure(error);}}
export async function PATCH(request:Request,context:Context){try{await guard(request);return json({draft:await updateDraft((await context.params).draftId,await draftBody(request))});}catch(error){return failure(error);}}
