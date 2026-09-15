# QR Structure Explorer

Client-side QR Code Model 2 structure explorer. Upload one QR image to decode its payload locally and inspect each module by fixed pattern, data codeword, error-correction block, or remainder bit.

## Requirements

- Nix with flakes enabled, or Node.js 24+

## Install

Use the repository toolchain:

```sh
nix develop -c npm ci
```

Without Nix, use Node.js 24+:

```sh
npm ci
```

## Run locally

```sh
nix develop -c npm run dev -- --host 127.0.0.1
```

Open the printed local URL, choose an image file, and inspect the decoded QR symbol. The app runs entirely in the browser; decoded URL-looking payloads are shown as text and are not fetched or opened.

## Checks

```sh
nix develop -c npm test
nix develop -c npm run typecheck
nix develop -c npm run build
```

## Supported input

- Standard QR Code Model 2 symbols, versions 1–40
- One detector-selected QR symbol per image
- Numeric, alphanumeric, byte/binary, Kanji/Kana, Hanzi, ECI, FNC1, and structured-append stream controls

Micro QR and rMQR are not supported.
