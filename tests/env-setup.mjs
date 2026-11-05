// Synthetic test configuration only. Never load a developer's real .env.local.
process.env.RESEND_INBOXES=JSON.stringify(['personal','agents','assistant'].map((key,i)=>({key,id:`00000000-0000-4000-8000-00000000000${i+1}`,name:key,address:`${key}@example.com`,description:'Synthetic test inbox'})));
process.env.LETTERDOCK_SENDING_INBOX='personal';
process.env.LETTERDOCK_ORIGIN='https://mail.example.com';
delete process.env.RESEND_API_KEY;
globalThis.fetch=async()=>{throw new Error('Tests block real network requests. Mock fetch explicitly.');};
