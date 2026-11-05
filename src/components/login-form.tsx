"use client";
import { useState } from 'react';
import { Mail, LockKeyhole, ArrowRight } from 'lucide-react';
import styles from './connection-form.module.css';
export function LoginForm({configured}:{configured:boolean}) {
  const [password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    try {
      const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({password})});
      const result=await response.json();
      if(!response.ok)throw new Error(typeof result.error==='string'?result.error:'Couldn’t sign in. Try again.');
      setPassword('');window.location.assign('/');
    } catch(err){setError(err instanceof Error?err.message:'Couldn’t sign in. Try again.');setBusy(false);}
  }
  return <main className={styles.shell}><a className={styles.brand} href="/"><span><Mail size={20}/></span>letterdock<span className={styles.period}>.</span></a><div className={styles.content}><section className={styles.card} aria-labelledby="login-title"><span className={styles.icon}><LockKeyhole size={24}/></span><h1 id="login-title">Your inbox, docked.</h1>{configured ? <form onSubmit={submit} className={styles.loginForm}><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy} aria-describedby={error?'login-error':undefined}/>{error&&<p id="login-error" role="alert">{error}</p>}<button className={styles.primary} disabled={busy}>{busy?'Signing in…':'Open inbox'}<ArrowRight size={16}/></button></form> : <p>Authentication is not configured. Run <code>npm run setup</code> on the server, then restart Letterdock.</p>}</section></div></main>;
}
