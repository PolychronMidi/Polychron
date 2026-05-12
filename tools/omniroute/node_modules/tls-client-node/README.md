<div align="center">
  <h1>tls-client-node</h1>
  <p><strong>Managed-first Node.js wrapper for browser-like TLS profiles.</strong></p>
  <p>Explicit lifecycle, upstream-aligned payloads, and published package distribution without singleton-style API state.</p>
  <p>
    <a href="https://www.npmjs.com/package/tls-client-node">
      <img src="https://img.shields.io/npm/v/tls-client-node" alt="npm version" />
    </a>
    <a href="https://www.npmjs.com/package/tls-client-node">
      <img src="https://img.shields.io/npm/dm/tls-client-node" alt="npm downloads" />
    </a>
    <a href="https://github.com/fatihkabakk/tls-client-node/actions/workflows/ci.yml">
      <img src="https://github.com/fatihkabakk/tls-client-node/actions/workflows/ci.yml/badge.svg?branch=master" alt="CI status" />
    </a>
    <img src="https://img.shields.io/badge/runtime-native%20%7C%20managed%20%7C%20remote-0f766e" alt="Runtime modes" />
    <img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="TypeScript strict" />
    <img src="https://img.shields.io/badge/license-source--available-black" alt="Source available" />
  </p>
  <p>
    <a href="https://www.npmjs.com/package/tls-client-node">
      <img src="https://nodei.co/npm/tls-client-node.png?downloads=true&stars=true" alt="npm package banner" />
    </a>
  </p>
</div>

<div align="center">
  <p>
    Browser-like TLS profiles are not just about the <code>user-agent</code> header. Servers inspect the full handshake,
    HTTP/2 behavior, and related transport traits. <b>tls-client-node</b> gives Node.js a cleaner wrapper around that
    upstream capability while keeping the lifecycle explicit instead of hiding it behind singleton state.
  </p>
</div>

`tls-client-node` is a source-available Node.js client for `bogdanfinn/tls-client`. It uses managed `tls-client-api` mode by default for predictable async concurrency, keeps lifecycle control explicit through `TLSClient` and `Session`, and can also run through direct shared-library loading when native mode is explicitly selected.

## Why tls-client-node

| Focus | What you get |
| --- | --- |
| Managed-first local runtime | Uses the `tls-client-api` sidecar process by default for more predictable concurrent async behavior. |
| Explicit lifecycle | `TLSClient` and `Session` keep ownership obvious, instead of hiding everything behind global init and destroy calls. |
| Upstream alignment | Custom TLS payloads and profile identifiers are kept close to Bogdan Finn's `tls-client` contract. |
| Migration practicality | Common `node-tls-client` aliases such as `ja3string`, `timeout`, `hostOverride`, and `randomTlsExtensionOrder` are supported. |
| Modern package surface | Published npm package with strict TypeScript types, named ESM imports, and CommonJS `require` support. |

## Highlights

- Clean named ESM imports and CommonJS `require` support.
- Default local runtime uses managed `tls-client-api`.
- Native mode is available through `runtimeMode: "native"`.
- Session-oriented API with explicit client and session control.
- Strict custom TLS handling with no silent fallback to stock client identifiers.

## Installation

```sh
npm install tls-client-node
# or
yarn add tls-client-node
# or
pnpm add tls-client-node
```

During `postinstall`, the package tries to download the matching upstream shared library for the current platform. If that step is skipped or fails, the required local asset is downloaded lazily on first startup.

Environment variables:

- `TLS_CLIENT_SKIP_DOWNLOAD=1` disables install-time downloads.
- `TLS_CLIENT_VERSION=1.14.0` pins the upstream asset version.
- `TLS_CLIENT_API_VERSION=1.14.0` is also recognized as an alias for `TLS_CLIENT_VERSION`.

## Imports

ESM named imports work directly:

```ts
import {
  ClientIdentifier,
  Emulation,
  MultipartForm,
  TLSClient,
  createMultipartForm,
} from "tls-client-node";

const client = new TLSClient();
const session = client.session({
  clientIdentifier: Emulation.chrome_136,
});
```

CommonJS is supported too:

```js
const { ClientIdentifier, Emulation, MultipartForm, TLSClient, createMultipartForm } = require("tls-client-node");
```

## Quick Start

```ts
import {
  ClientIdentifier,
  TLSClient,
} from "tls-client-node";

async function main() {
  const client = new TLSClient();
  const session = client.session({
    clientIdentifier: ClientIdentifier.chrome_136,
  });

  const response = await session.get("https://tls.peet.ws/api/all");
  console.log(response.status, await response.text());

  await session.close();
  await client.stop();
}

main().catch(console.error);
```

## High-Level Client

```ts
import { ClientIdentifier, TLSClient } from "tls-client-node";

const client = new TLSClient();

const session = client.session({
  clientIdentifier: ClientIdentifier.chrome_136,
  timeoutSeconds: 30,
  headers: {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    "accept-encoding": "gzip, deflate, br",
  },
});

const response = await session.get("https://tls.peet.ws/api/all");
console.log(response.status, response.usedProtocol);

await session.close();
await client.stop();
```

## One-Off Requests

```ts
import { ClientIdentifier, fetch } from "tls-client-node";

const response = await fetch("https://example.com", {
  clientIdentifier: ClientIdentifier.chrome_136,
  headers: {
    accept: "text/html",
  },
});

console.log(await response.text());
```

## Multipart Form Uploads

```ts
import { MultipartForm, TLSClient, createMultipartForm } from "tls-client-node";

const client = new TLSClient();
const form = createMultipartForm({
  title: "example",
  file: {
    data: "hello world",
    filename: "hello.txt",
    contentType: "text/plain",
  },
});

const builder = new MultipartForm()
  .append("kind", "builder")
  .appendJson("meta", { ok: true });

const response = await client.request("https://example.com/upload", {
  method: "POST",
  body: form,
});

console.log(response.status);

await client.request("https://example.com/upload-builder", {
  method: "POST",
  body: builder,
});

await client.stop();
```

## Redirect Ergonomics

```ts
import { TLSClient } from "tls-client-node";

const client = new TLSClient();
const session = client.session({
  redirect: "follow",
});

await session.get("https://example.com/start", {
  redirect: "manual",
});

await client.stop();
```

`redirect` is a higher-level alias for `followRedirects`.

- `redirect: "follow"` maps to `followRedirects: true`
- `redirect: "manual"` maps to `followRedirects: false`
- `redirect: true` and `redirect: false` are also accepted

## Runtime Modes

Default local mode is managed `tls-client-api`.

Use native mode only when you explicitly want direct shared-library loading:

```ts
import { TLSClient } from "tls-client-node";

const client = new TLSClient({
  runtimeMode: "native",
});
```

If you already host `tls-client-api` yourself, use remote mode:

```ts
import { TLSClient } from "tls-client-node";

const client = new TLSClient({
  baseUrl: "http://127.0.0.1:8080",
  apiKey: "my-auth-key-1",
});
```

## Custom TLS

```ts
import { TLSClient } from "tls-client-node";

const client = new TLSClient();

const response = await client.request("https://example.com/", {
  proxyUrl: "http://user:pass@proxy.example:5959",
  followRedirects: true,
  headers: {
    "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "accept-encoding": "gzip, deflate, br",
  },
  customTlsClient: {
    ja3String: "771,2570-4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,2570-0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513-2570-21,2570-29-23-24,0",
    h2Settings: {
      HEADER_TABLE_SIZE: 65536,
      MAX_CONCURRENT_STREAMS: 1000,
      INITIAL_WINDOW_SIZE: 6291456,
      MAX_HEADER_LIST_SIZE: 262144,
    },
    h2SettingsOrder: [
      "HEADER_TABLE_SIZE",
      "MAX_CONCURRENT_STREAMS",
      "INITIAL_WINDOW_SIZE",
      "MAX_HEADER_LIST_SIZE",
    ],
    supportedSignatureAlgorithms: [
      "ECDSAWithP256AndSHA256",
      "PSSWithSHA256",
      "PKCS1WithSHA256",
      "ECDSAWithP384AndSHA384",
      "PSSWithSHA384",
      "PKCS1WithSHA384",
      "PSSWithSHA512",
      "PKCS1WithSHA512",
    ],
    supportedVersions: ["GREASE", "1.3", "1.2"],
    keyShareCurves: ["GREASE", "X25519"],
    certCompressionAlgos: ["brotli"],
    pseudoHeaderOrder: [":method", ":authority", ":scheme", ":path"],
    connectionFlow: 15663105,
    headerOrder: ["accept", "user-agent", "accept-encoding", "accept-language"],
    priorityFrames: [
      {
        streamID: 1,
        priorityParam: {
          streamDep: 1,
          exclusive: true,
          weight: 1,
        },
      },
    ],
    headerPriority: {
      streamDep: 1,
      exclusive: true,
      weight: 1,
    },
    alpnProtocols: ["h2", "http/1.1"],
    alpsProtocols: ["h2"],
  },
  headerOrder: [":method", ":authority", ":scheme", ":path"],
});
```

## Notes

- Primary interface: create a `TLSClient`, create one or more `Session` instances, and stop the client when finished.
- Each `Session` keeps a `tough-cookie` jar in sync with request and response cookies. You can inspect URL cookies with `session.cookies(url)` or serialize the jar with `session.exportCookies()`.
- `Emulation` is exported as a higher-level alias for `ClientIdentifier`, so `Emulation.chrome_136` and `ClientIdentifier.chrome_136` are equivalent.
- Binary responses are returned as a data URL when `byteResponse: true` is enabled, matching upstream behavior.
- `FormData`, `MultipartForm`, and `createMultipartForm()` can all be used for multipart uploads, with the generated boundary preserved in the `content-type` header.
- `redirect` is a higher-level alias over `followRedirects`; it improves call-site clarity without changing upstream redirect semantics.
- WebSocket upgrade and frame APIs are not currently implemented in this wrapper.
- New upstream client identifiers can be passed as plain strings even before this package adds them to `ClientIdentifier`.
- Custom TLS requests remain custom-only. Rejections such as `tls: illegal parameter` or `unknown ClientHelloID: Custom-1` throw `ERR_CUSTOM_TLS_REJECTED` instead of falling back silently.
- If `certCompressionAlgo` is provided, it is normalized to the upstream `certCompressionAlgos` field before the request is sent.
- `new TLSClient()` is the primary lifecycle model. The top-level `fetch()` helper uses an isolated temporary client when you do not pass an explicit `client` or `session`.

## License

This project is distributed under Apache License 2.0 with Commons Clause.

- You can use, modify, embed, and redistribute the library under the public license terms.
- You cannot sell the library itself, or sell a product or service whose value derives entirely or substantially from `tls-client-node`, without separate permission.
- Upstream runtime components downloaded by this package are subject to their own licenses and notices. See `NOTICE`.

This is source-available, not OSI open source.

## Acknowledgement

This product includes software developed by Bogdan Finn and contributors via `bogdanfinn/tls-client` and `bogdanfinn/tls-client-api`.