# Release checks

Before making a release public, the maintainer checks:

1. The public source is a clean, reusable edition with no private hosting connection, real mailbox configuration, message contents, or inherited private Git history.
2. The publishable tree and initial Git history pass Gitleaks with redaction and the public-source guard.
3. `npm ci`, TypeScript, the synthetic test suite, and the production build succeed without provider credentials.
4. Authentication rejects unsigned/expired/wrong-owner sessions; CSRF checks reject untrusted origins; disabled sending reaches no provider endpoint.
5. A local production-server check verifies login/session/logout behavior and mail-route authorization, without using real mail.
6. Dependency audit findings are reviewed and resolved before the first release.
7. Contributor workflows run with a read-only token, no mail secrets, and no automatic deployment. Outside-contributor workflow approval and branch review protections are verified on GitHub.

These checks reduce publication and application risk. They are not a formal security audit, exhaustive penetration test, or proof of absence of vulnerabilities. Manual live-provider coverage and the exact CI result should be recorded in the release notes. Tests use mocked provider responses and synthetic identities; they never send a real email.
