// Guard the publishable source. A dedicated secret scanner is still required for releases.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = process.cwd();
const skipped = new Set(['.git','node_modules','.next','outputs','coverage','dist','out']);
function walk(directory) {
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry => {
    if (skipped.has(entry.name)) return [];
    const path = resolve(directory,entry.name);
    return entry.isDirectory() ? walk(path) : [relative(root,path)];
  });
}
let files;
try {
  const gitRoot = execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  if (resolve(gitRoot) !== root) throw new Error('Not this repository');
  files = execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
} catch { files = walk(root); }
const forbiddenPath = /(^|\/)(?:\.openai|\.secrets|\.aws|\.ssh|outputs)(?:\/|$)|(^|\/)\.env(?!\.example$)(?:\.|$)|\.(?:pem|p12|pfx|key)$/i;
const patterns = [
  /\bre_[A-Za-z0-9_-]{20,}\b/,
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\/Users\/[^\s/]+\//,
  /NEXT_PUBLIC_(?:RESEND|LETTERDOCK_(?:PASSWORD|SESSION))/,
];
const failures = [];
for (const file of files) {
  if (forbiddenPath.test(file) || lstatSync(file).isSymbolicLink()) { failures.push(file); continue; }
  const bytes = readFileSync(file);
  if (bytes.length > 2_000_000) { failures.push(file); continue; }
  if (bytes.includes(0)) continue;
  if (patterns.some(pattern=>pattern.test(bytes.toString('utf8')))) failures.push(file);
}
if (failures.length) {
  console.error('Public-source guard failed. Inspect these files locally; no matched values are printed:');
  failures.forEach(file=>console.error(file)); process.exitCode=1;
} else { console.log(`Public-source guard passed (${files.length} files).`); }
