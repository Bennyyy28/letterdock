import test from 'node:test';
import assert from 'node:assert/strict';
import { safeWebUrl } from '../src/lib/mail-links';
import { cleanHtml } from '../src/lib/reader';

test('web links preserve signed query strings, fragments, escapes and case exactly', () => {
  for (const url of ['https://example.com/verify?token=A%2Fb%2Bz%3D&next=%2Fwelcome#done', 'HTTP://Example.com:8080/a(b)?x=1+2', 'https://例え.jp/path', 'https://[::1]:8080/']) assert.equal(safeWebUrl(url), url);
});

test('web links reject executable, local, relative, ambiguous and credential-bearing URLs', () => {
  for (const url of ['javascript:alert(1)','data:text/html,hi','vbscript:alert(1)','file:///etc/passwd','blob:https://example.com/id','mailto:test@example.com','//example.com','/verify','https:///example.com','https://','https://@example.com','https://good.example@evil.example','https://user:pass@example.com','https://example.com\\@evil.example','https://example.com/with space',' https://example.com','https://example.com/\nverify','https://example.com/\u0000','https://example.com:invalid/']) assert.equal(safeWebUrl(url), null, url);
});

test('HTML verification links retain exact destinations and override sender targets and tracking', () => {
  const url = 'https://example.com/verify?token=A%2Fb%2Bz%3D&next=%2Fwelcome#done';
  const html = cleanHtml(`<a href="${url.replaceAll('&','&amp;')}" target="_top" rel="opener" ping="https://tracker.test" download="verify" onclick="alert(1)" style="color:red">Verify account</a><img src="https://tracker.test/pixel"><meta http-equiv="refresh" content="0;url=https://evil.test"><form action="https://evil.test"><button>Submit</button></form>`);
  assert.match(html, /href="https:\/\/example.com\/verify\?token=A%2Fb%2Bz%3D&amp;next=%2Fwelcome#done"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, />Verify account<\/a>/);
  assert.doesNotMatch(html, /_top|ping=|download=|onclick=|style=|<img|<meta|<form|<button|tracker\.test/);
});

test('entity-obfuscated unsafe anchors lose navigation but retain readable text', () => {
  const html = cleanHtml('<a href="jav&#x61;script:alert(1)">Unsafe</a><a href="&#x2f;&#x2f;evil.test">Relative</a><a href="https://good.test&#x0a;@evil.test">Ambiguous</a><a href="https://user:pass@evil.test">Credentials</a>');
  assert.doesNotMatch(html, /href=|target=|rel=/);
  assert.match(html, /Unsafe/);
  assert.match(html, /Relative/);
});
