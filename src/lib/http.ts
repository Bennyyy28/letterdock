import { getOwner } from './owner';
import { sameOrigin } from './auth';
import { MailError } from './mailboxes';
export async function guard(request:Request) {
  if(!sameOrigin(request))throw new MailError('Request not allowed.',403);
  const user=await getOwner();
  if(!user)throw new MailError('Sign in to Letterdock.',401);
  return user;
}
export function json(body:unknown,status=200,headers:Record<string,string>={}) {return Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});}
export function failure(error:unknown) {return json({error:error instanceof MailError ? error.message : 'The request could not be completed.'},error instanceof MailError ? error.status : 500);}

export async function draftBody(request:Request):Promise<unknown> {
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new MailError('Use a JSON draft request.',415);
 if(Number(request.headers.get('content-length')||0)>200000)throw new MailError('The draft is too large.',413);
 const reader=request.body?.getReader();if(!reader)throw new MailError('The draft request is empty.',400);
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>200000){await reader.cancel();throw new MailError('The draft is too large.',413);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new MailError('The draft request is invalid.',400);}
}
