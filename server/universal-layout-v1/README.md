# Universal Layout Contract v1

Version: `universal-layout.v1`  
Schema version: `1`  
Package: host-side Development/Mock adapter contract; not connected to the central AI endpoint.

## Files

- `universal-layout-contract.ts` — verbatim copy of the central pure contract module.
- `universal-layout-contract.test.ts` — verbatim copy of the central Universal v1 tests.
- `demo-coffee-policy.ts` — the current `democoffee` / `cafe.menu` policy fixture.
- `example.ts` — creates and validates a normal request and a valid one-column plan; also demonstrates a rejected plan.
- `golden-vector.json` — canonicalization input, expected canonical JSON and SHA-256.
- `package.json`, `tsconfig.json` — ESM TypeScript setup and required dependencies.

The included DemoCoffee policy is a host integration/test fixture, not an assertion that this new contract is registered on a production or Development API route. The existing menu.v2 and options.v1 engines remain separate.

## Requirements and usage

Requires Node.js 20 or later and npm.

```sh
npm install
npm test
npm run example
```

The module exports strict Zod schemas and inferred TypeScript types for the model/request and plan, plus:

- `createUniversalLayoutModel(policy, options)`
- `validateUniversalLayoutModel(value, policies)`
- `validateUniversalLayoutPlan(value, model, policies)`
- `canonicalUniversalJson(value)`
- `universalSha256(value)`
- `computeUniversalStructureHash(model)`
- `computeUniversalConstraintHash(model)`

Import from `./universal-layout-contract.js` in Node ESM TypeScript. `example.ts` shows policy registration, request construction, validation, and plan validation.

## Hash rules and golden vector

Canonicalization sorts object keys, normalizes strings and keys to Unicode NFC, preserves array order, distinguishes `null` from omitted properties, normalizes `-0` to `0`, and rejects non-safe-integer numbers, unsupported values, and keys that collide after NFC normalization. SHA-256 is calculated over the UTF-8 canonical JSON string and emitted as lowercase hexadecimal.

Golden input:

```json
{"b":2,"a":"é"}
```

Canonical JSON:

```json
{"a":"é","b":2}
```

SHA-256:

```text
06c264c46ad5ada9493abd3aa2383fb205ae99d7d0bad40b03a43bfec8a1b8de
```

`universal-layout-contract.test.ts` asserts this same vector and canonicalization behavior.

## Accepted and rejected examples

The example constructs a `democoffee` / `cafe.menu` request with `structureVersion: "menu.v2"` and `viewportClass: "regular"`. Its registered fixture permits columns 1 and 2. A plan selecting 1 column is accepted; selecting 3 is rejected with `DISALLOWED_COLUMN_COUNT`. Unknown targets/operations, extra fields, mismatched hashes, and stale model identifiers are also rejected by the strict schemas/validator.

This package contains no server authentication, OpenAI client, route code, database access, SDK, credentials, or secrets. It imports `zod` and Node's built-in `node:crypto` only. Because the exact shared implementation uses synchronous `node:crypto`, it is **Node server-side compatible, not directly browser-bundle compatible**. A browser adapter would require a coordinated central change; do not substitute a separate host hash implementation.

## Civil-service kiosk policy

The kiosk policy is not confirmed. The included test fixture uses 18 items and assumed columns (`compact: [1]`, `regular: [1, 2]`, `wide: [1, 2, 3]`) solely to exercise the common validator. It is not an approved device policy and must not be used for real issuance or deployed behavior.
