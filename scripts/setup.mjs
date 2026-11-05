import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const rotate = process.argv.slice(2).join(' ') === '--rotate-auth';
if (process.argv.length > 2 && !rotate) {
  console.error('Usage: npm run setup [-- --rotate-auth]'); process.exit(1);
}
if (existsSync('.env.local') && (!rotate || !lstatSync('.env.local').isFile())) {
  console.error('.env.local already exists; use --rotate-auth only to replace its authentication values.'); process.exit(1);
}
if (rotate && !existsSync('.env.local')) {
  console.error('Run npm run setup first.'); process.exit(1);
}
const password = randomBytes(24).toString('base64url');
const salt = randomBytes(16);
const hash = `scrypt:${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
const secret = randomBytes(32).toString('base64url');
let content = rotate ? readFileSync('.env.local','utf8') : readFileSync(new URL('../.env.example',import.meta.url),'utf8');
for (const [name,value] of Object.entries({LETTERDOCK_PASSWORD_HASH:hash,LETTERDOCK_SESSION_SECRET:secret})) {
  const line = new RegExp(`^${name}=.*$`,'m');
  content = line.test(content) ? content.replace(line,`${name}=${value}`) : `${content}\n${name}=${value}\n`;
}
if (rotate) {
  const temporary = `.env.local.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(temporary,content,{flag:'wx',mode:0o600});
  renameSync(temporary,'.env.local');
} else {
  writeFileSync('.env.local',content,{flag:'wx',mode:0o600});
}
console.log(`${rotate?'Rotated authentication in':'Created'} .env.local (mode 0600). Save this generated login password in your password manager:`);
console.log(password);
console.log(rotate ? 'Restart Letterdock. Existing sessions and draft reviews will be invalidated.' : 'Next: edit .env.local with your Resend API key and inbox IDs. Do not commit it.');
