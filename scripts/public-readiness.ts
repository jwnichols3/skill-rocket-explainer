#!/usr/bin/env node
// Public-readiness check: scans the repo's files (tracked, plus untracked ones that are not
// ignored) for things that must not be published. Prints file:line findings; exits 1 if any.
//
//   node scripts/public-readiness.ts [repo dir]
//
// Checks: personal absolute paths (/Users/<name>, /home/<name>), AWS access key ids, private
// key blocks, 12-digit AWS account ids, and personal identifiers listed one per line in an
// untracked `.public-readiness-denylist` at the repo root (gitignored, so the names themselves
// are never committed; # starts a comment). Deliberate fakes: AWS's documented examples and
// repeated-digit account ids pass; any other line can carry the marker `public-readiness: allow`.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const ALLOW_MARKER = 'public-readiness: allow';
/** Placeholder user names that are fine in docs and examples. */
const PLACEHOLDER_USERS = new Set(['you', 'user', 'username', 'me', 'name', 'example', 'runner', 'someone', 'your-name', 'yourname', 'shared']);
/** AWS's documentation examples. */
const FAKE_VALUES = new Set(['AKIAIOSFODNN7EXAMPLE', '123456789012']);

interface Rule { kind: string; re: RegExp; ok?: (match: RegExpExecArray) => boolean }
const RULES: Rule[] = [
  { kind: 'personal path', re: /\/(?:Users|home)\/([A-Za-z0-9._-]+)/g, ok: (m) => PLACEHOLDER_USERS.has(m[1].toLowerCase()) },
  { kind: 'AWS access key', re: /(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/g, ok: (m) => FAKE_VALUES.has(m[0]) },
  { kind: 'private key', re: /-{5}BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-{5}/g },
  { kind: 'AWS account id', re: /(?<![A-Za-z0-9_.])\d{12}(?![A-Za-z0-9_])/g, ok: (m) => FAKE_VALUES.has(m[0]) || /^(\d)\1{11}$/.test(m[0]) },
];

function denylist(): Rule[] {
  const file = join(root, '.public-readiness-denylist');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).map((term) => ({
    kind: 'denylisted identifier',
    re: new RegExp(`(?<![A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'gi'),
  }));
}

/** Files exempt from the denylist: the license names its copyright holder on purpose. */
const DENYLIST_EXEMPT = new Set(['LICENSE']);

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const deny = denylist();
const findings: string[] = [];
for (const file of files) {
  let text: string;
  try { text = readFileSync(join(root, file), 'utf8'); } catch { continue; }
  if (text.includes('\0')) continue;
  const rules = DENYLIST_EXEMPT.has(file) ? RULES : [...RULES, ...deny];
  text.split('\n').forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const rule of rules) {
      for (const m of line.matchAll(rule.re)) {
        if (!rule.ok?.(m as RegExpExecArray)) findings.push(`${file}:${i + 1}: ${rule.kind}: ${m[0]}`);
      }
    }
  });
}

if (findings.length) {
  console.log(findings.join('\n'));
  console.log(`\npublic-readiness: ${findings.length} finding(s) in ${files.length} files${deny.length ? ` (${deny.length} denylist terms)` : ''}`);
  process.exit(1);
}
console.log(`public-readiness: ok (${files.length} files${deny.length ? `, ${deny.length} denylist terms` : ', no local denylist'})`);
