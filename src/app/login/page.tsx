import { redirect } from 'next/navigation';
import { getOwner } from '../../lib/owner';
import { authConfigured } from '../../lib/session';
import { LoginForm } from '../../components/login-form';
export const dynamic='force-dynamic';
export default async function LoginPage() { if(await getOwner())redirect('/');return <LoginForm configured={authConfigured()}/>; }
