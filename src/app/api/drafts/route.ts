import 'server-only';
import { listDrafts,createDraft } from '@/lib/drafts';
import { guard,json,failure,draftBody } from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{await guard(request);return json(await listDrafts(new URL(request.url).searchParams.get('after')||undefined));}catch(error){return failure(error);}}
export async function POST(request:Request){try{await guard(request);return json({draft:await createDraft(await draftBody(request))},201);}catch(error){return failure(error);}}
