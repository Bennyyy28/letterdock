import 'server-only';
import { manageThread, threadActionBody } from '@/lib/thread-actions';
import { guard, json, failure } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: {params: Promise<{inboxKey: string; threadId: string}>}) {
  try {
    await guard(request);
    const action = await threadActionBody(request);
    const {inboxKey, threadId} = await context.params;
    return json(await manageThread(inboxKey, threadId, action));
  } catch (error) { return failure(error); }
}
