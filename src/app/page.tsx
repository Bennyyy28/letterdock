import { MailApp } from '../components/mail-app';
import { requireOwner } from '../lib/owner';
export const dynamic = 'force-dynamic';
export default async function Home() { await requireOwner(); return <MailApp />; }
