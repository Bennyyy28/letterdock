import 'server-only';
import { MAILBOXES, sendingMailbox } from '@/lib/mailboxes';
import { guard, json, failure } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET(request:Request) {
  try {
    await guard(request);
    const connected=!!process.env.RESEND_API_KEY && MAILBOXES.length > 0;
    let sender: string | null = null;
    if (connected && process.env.LETTERDOCK_SENDING_INBOX) sender=sendingMailbox().key;
    return json({connected,mode:connected?'live':'setup',authenticated:true,requiresLogin:false,
      mailboxes:MAILBOXES.map(({id,...publicFields})=>publicFields),sendingEnabled:!!sender,sendingInbox:sender,
      ownerName:(process.env.LETTERDOCK_OWNER_NAME||'My inbox').slice(0,60)});
  } catch(error) {return failure(error);}
}
