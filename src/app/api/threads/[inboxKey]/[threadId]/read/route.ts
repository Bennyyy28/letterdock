import 'server-only';
import { markThreadRead, requireEmptyReadBody } from '@/lib/read-state';
import { guard, json, failure } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ inboxKey: string; threadId: string }> }) {
  try {
    await guard(request);
    await requireEmptyReadBody(request);
    const { inboxKey, threadId } = await context.params;
    return json(await markThreadRead(inboxKey, threadId));
  } catch (error) { return failure(error); }
}
