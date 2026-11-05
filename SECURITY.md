# Security policy

## Report a vulnerability privately

Use [GitHub's private vulnerability reporting](https://github.com/Bennyyy28/letterdock/security/advisories/new). Do not put API keys, session cookies, real email, verification links, or personal account details in a public issue. Include the affected version, steps to reproduce with synthetic data, and the expected security boundary. If private reporting is temporarily unavailable, use GitHub's Report abuse/support tools without publishing sensitive details.

The current `0.1.x` release line is maintained on a best-effort basis. This is a community project with no response-time guarantee. Keep your installation and dependencies current.

## Intended deployment

Letterdock is a single-owner, self-hosted application. Anyone with the owner password/session can read and organize every configured inbox and, when enabled, prepare and send from the configured sender. There are no per-user roles, tenant isolation, OAuth accounts, MFA, or immutable audit logs. For stronger access controls, use a private gateway or identity-aware proxy in addition to the app login.

The Resend API key stays on the server. Resend currently requires Full Access to read inboxes; this credential can manage resources beyond Letterdock's exposed routes. Letterdock does not turn an account-wide key into a provider-enforced restricted credential. Use a dedicated key and preferably a separate team/account for isolation. Never expose server configuration to an agent or public demo.

## Built-in boundaries

- Missing or malformed authentication configuration fails closed. No setup bypass exposes mail.
- The password is stored as a salted scrypt hash. Sessions are signed with a separate random secret, expire after eight hours, and are bound to the password revision and configured origin.
- Cookies are HttpOnly, SameSite Strict, and Secure for HTTPS. HTTPS is required away from loopback. Rotate authentication and restart to invalidate sessions.
- Every mail API checks the owner session. Writes require an exact configured Origin; attacker-controlled Host/forwarded headers do not set the trusted origin.
- Login bodies and mail mutation bodies are size-limited. Login has a process-local backstop of ten attempts per five minutes. This is not a distributed or IP-aware rate limiter; deploy proxy/edge limits as well.
- The server selects inboxes from an operator-configured allowlist. Browser input cannot supply an arbitrary provider inbox ID or From address.
- Email HTML is sanitized on the server and placed in an opaque, scriptless iframe with a restrictive CSP. Remote content, scripts, forms, and tracking resources are blocked. Explicit HTTP(S) links open with `noopener noreferrer`; URLs are not fetched or previewed by the server.
- Mail reads do not mutate Resend. Explicit opens mark read; archive, trash, restore, and unread require explicit action. There is no permanent-delete route.
- Sending is disabled by default. Enabled sends require a saved-draft review bound to the owner, content, and expiry. Provider idempotency keys reduce duplicate writes; ambiguous writes are not automatically retried.
- Mail API responses are private and not cached. Provider errors are reduced to generic messages instead of returning response bodies or credentials.

## Limits operators must understand

Email may contain phishing links even after rendering is sanitized. Destination disclosure helps inspect a link; it does not certify it. Read external sites cautiously.

Letterdock cannot prove an authenticated API caller is a human, and it cannot constrain an agent with direct Resend credentials or control of the host. Enforce agent approval policies separately. Draft reviews reduce accidental sends, but cannot make provider-side concurrent edits and sends atomic; this is a single-owner application.

The app holds a per-process request scheduler, not a durable distributed queue. Use one instance or add shared provider rate limiting. Do not share the instance among unrelated users. Restrict body sizes, request duration, and login rates at the proxy; configure HTTPS, safe host routing, access logs without mail/password bodies, and prompt security updates.

No independent penetration test or formal audit is claimed. See [release checks](docs/RELEASE_CHECKS.md) for the concrete validation used before publication.
