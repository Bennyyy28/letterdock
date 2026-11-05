# Changelog

## 0.1.0

First public, self-hosted release of Letterdock.

- Configurable Resend inboxes, responsive reading, search, folders, and explicit read/folder actions.
- Optional compose, reply, saved drafts, and content-bound review before sending.
- Owner login, server-only configuration, exact-origin write checks, and isolated mail rendering.
- MIT license, setup/deployment guidance, contribution templates, and secret-free CI.

Validation: 48 synthetic unit tests, 75 production HTTP checks against an intercepted synthetic provider, TypeScript, production build, desktop/mobile visual review, dependency audit, public-source guard, and Gitleaks. The public edition has not been connected to a live Resend account; no real mail was read or sent during its validation. This is an early single-owner release with attachment metadata only.
