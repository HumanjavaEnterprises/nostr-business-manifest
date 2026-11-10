# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Which versions are eligible for receiving such patches depends on the CVSS v3.0 Rating:

| CVSS v3.0 | Supported Versions                        |
| --------- | ---------------------------------------- |
| 9.0-10.0  | Releases within the last 6 months        |
| 4.0-8.9   | Most recent release                      |

## Threat model — the private-key boundary is the whole safety of this library

`nostr-business-manifest` builds a business manifest and signs it as a Nostr event. Its safety rests on one boundary:

- **`signManifest` is the ONLY function that touches a private key, and it is ENCLAVE/CLIENT-ONLY.**
  It accepts an `nsec` (bech32 or 64-char hex), uses it to derive the public key and produce the schnorr
  (BIP340) signature, and then lets it go out of scope. The private key is **never** returned on the signed
  event, logged, persisted, transmitted, or included in an error message. The scalar bytes are zeroed before
  the call returns. Run `signManifest` only where the key is allowed to live — a browser, a hardware enclave,
  an offline signer — never on a shared server.

- **Everything else touches PUBLIC material only.** `buildBusinessManifest`, `validateBusinessManifest`,
  `linksToChannels`, `bindEntity`, and `verifyManifest` never see a private key and are safe to run anywhere,
  including a server. `verifyManifest` requires kind `30078`, exactly one `d` tag and lowercase hex, recomputes
  the event id, schnorr-verifies the signature against the event's public key, validates the manifest schema,
  and asserts the manifest's claimed `npub` matches the signing key — so a manifest signed by a different key
  than it claims, a text note, or other app data from the same key is rejected.

- **Private-key inputs are rejected without echo.** `normalizePrivateKey` refuses anything that is not a
  private key (a public key, a wrong-length value, a mnemonic) with an error that never contains the input,
  so a mis-supplied key cannot leak through an error string or log.

## Audited stack

Runtime dependencies are limited to the audited, zero-transitive set, pinned exact: `@noble/curves`
(schnorr / BIP340), `@noble/hashes` (sha256), and `@scure/base` (bech32 / hex). There is no `nostr-tools`
dependency — the NIP-01 event id and schnorr operations are built directly on `@noble`. `nostr-zpub-utils`
is an optional peer used only by `bindEntity`.

## Reporting a Vulnerability

Please report security vulnerabilities through GitHub's Security Advisory feature at [https://github.com/humanjavaenterprises/nostr-business-manifest/security/advisories/new](https://github.com/humanjavaenterprises/nostr-business-manifest/security/advisories/new).

The team will acknowledge your report within 48 hours, and will send a more detailed response within 72 hours indicating the next steps in handling your report.

After the initial reply to your report, the security team will endeavor to keep you informed of the progress towards a fix and full announcement, and may ask for additional information or guidance.

## Disclosure Policy

When the security team receives a security bug report, they will assign it to a primary handler. This person will coordinate the fix and release process.

## Comments on this Policy

If you have suggestions on how this process could be improved please submit a pull request.
