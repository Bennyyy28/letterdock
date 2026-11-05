import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MailText, MessageLinkDestinations, tokenizeMailText, plainTextLinks } from '../src/components/mail-text';
import { Message } from '../src/components/mail-app';
import { messageSandbox } from '../src/lib/message-document';
import type { MailMessage } from '../src/lib/mail-types';

const signed = 'https://example.com/verify?token=A%2Fb%2Bz%3D&next=%2Fwelcome#done';

test('plain-text links preserve signed queries and all surrounding text', () => {
  const text = `First\n${signed}\nAgain ${signed} <script>alert(1)</script>`;
  const parts = tokenizeMailText(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(parts.filter(part => part.href).map(part => part.href), [signed, signed]);
  assert.deepEqual(plainTextLinks(text), [{ href: signed, label: signed }]);
  assert.deepEqual(tokenizeMailText('Go (https://example.com/a(b)).').filter(part => part.href).map(part => part.href), ['https://example.com/a(b)']);
});

test('plain-text links reject unsafe schemes, credentials, backslashes and embedded scheme suffixes', () => {
  const text = 'javascript:alert(1) data:text/html,test /relative //example.com https://user:pass@example.com https://example.com\\bad javascript:https://example.com';
  assert.equal(tokenizeMailText(text).filter(part => part.href).length, 0);
  assert.equal(tokenizeMailText(text).map(part => part.text).join(''), text);
});

test('React renders ordinary new-tab links with exact destination titles and escapes email markup', () => {
  const html = renderToStaticMarkup(React.createElement(MailText, { text: signed + ' <script>alert(1)</script>' }));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('referrerPolicy="no-referrer"'));
  assert.ok(html.includes(`href="${signed.replaceAll('&', '&amp;')}"`));
  assert.ok(html.includes(`title="${signed.replaceAll('&', '&amp;')}"`));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
});

test('destination disclosure renders an inspectable full URL separately from an email link label', () => {
  const html = renderToStaticMarkup(React.createElement(MessageLinkDestinations, { links: [{ href: signed, label: 'Verify account' }] }));
  assert.ok(html.includes('<details'));
  assert.ok(html.includes('<summary>Link destinations'));
  assert.ok(html.includes('Verify account'));
  assert.ok(html.includes(`>${signed.replaceAll('&', '&amp;')}</a>`));
  assert.equal(renderToStaticMarkup(React.createElement(MessageLinkDestinations, { links: [] })), '');
});

test('HTML mail defaults to formatted rendering while text-only mail stays readable during SSR', () => {
  const message: MailMessage = { id: 'synthetic', from: 'sender@example.com', to: ['reader@example.net'], cc: [], subject: 'Synthetic', text: '', safeHtml: '<p><a href="https://example.com">Verify</a></p>', receivedAt: '2026-11-04T18:00:00Z', attachments: [], direction: 'inbound' };
  for (const text of ['', 'The multipart plain-text alternative.']) {
    const html = renderToStaticMarkup(React.createElement(Message, { message: { ...message, text } }));
    assert.ok(html.includes('Show plain text'));
    assert.ok(html.includes('Preparing formatted message…'));
    assert.ok(!html.includes('This message has no plain-text version'));
  }
  const textOnly = renderToStaticMarkup(React.createElement(Message, { message: { ...message, safeHtml: undefined, text: 'A readable text-only message.' } }));
  assert.ok(textOnly.includes('A readable text-only message.'));
  assert.doesNotMatch(textOnly, /Preparing formatted message|Show plain text|Show formatted message|<iframe/);
  assert.equal(messageSandbox, 'allow-popups allow-popups-to-escape-sandbox');
});
