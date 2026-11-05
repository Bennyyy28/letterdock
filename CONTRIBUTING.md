# Contributing to Letterdock

Thanks for helping make a useful, open inbox for Resend. Bug reports, accessibility improvements, documentation, and code contributions are welcome.

## Start here

For a small fix, open a pull request. For a new feature, first open an issue with the problem and proposed behavior so we can agree on scope. Security vulnerabilities belong in [private reporting](SECURITY.md), not public issues.

Fork the repository, create a branch, and install dependencies with `npm ci`. Run `npm run setup` if you need the local login page. Use only synthetic inboxes and a dedicated test Resend account for any manual provider testing. You do not need a Resend key to run the automated tests or build.

Before submitting:

```sh
npm run typecheck
npm test
npm run check:public
npm run build
npm run smoke
npm audit
```

Describe what changes for the user, how you tested it, and any limits. Include desktop/mobile screenshots when a UI change benefits from them, using synthetic messages only. Keep each pull request focused.

## Mail and credentials

- Never commit real messages, addresses, inbox IDs, verification URLs, attachments, API keys, `.env.local`, session cookies, or production screenshots.
- Treat all message content as untrusted. Preserve sanitization, sandboxing, safe links, authentication, and origin checks.
- Keep provider credentials on the server. Do not add browser-exposed secret variables.
- Keep sending explicit, disabled by default, fixed to the configured inbox, and tied to a saved-draft review. Do not add agent auto-send or automatic retries of ambiguous writes.
- Tests must mock provider requests. Do not add tests or CI steps that contact a live inbox.
- Do not add secret-bearing workflows, automatic production deployment, `pull_request_target` execution of contributor code, or self-hosted CI runners.

## Review and releases

Anyone can propose a change through a fork and pull request. Maintainers review and merge contributions; opening a pull request does not grant write access or access to a deployment. CI uses a read-only token and no mail secrets. Outside-contributor workflows require maintainer approval before running.

Releases are reviewed from a clean checkout and scanned for credentials and private data. Dependency updates are proposed as pull requests and are reviewed like code changes. There is no automatic merge or live deployment.

Contributions are licensed under the project's MIT license. Preserve attribution for third-party code and assets. Please follow the [community guidelines](CODE_OF_CONDUCT.md).
