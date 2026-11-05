# Suflyor

A web page that listens to the room through the microphone and shows live English to Russian translation. It runs in a browser and installs on the iPhone Home Screen. No bot joins the call.

## How it works

- The page records the microphone and sends the audio straight to [Soniox](https://soniox.com), which streams recognition and translation back.
- A small Cloudflare Worker (`src/worker.ts`) holds the Soniox API key. The page sends the access code to the Worker and gets a short-lived Soniox key. It lasts 60 seconds, which is enough to open the stream.
- There is no service worker. The app needs the network, and a cache would keep old versions on the phone.

## Requirements

Node.js, a Soniox API key, a Cloudflare account for the Worker.

## Run

```sh
npm install
npm run dev
```

`npm run dev` builds the page and starts the Worker locally with wrangler. Put the secrets for local runs in `.dev.vars`, which is git-ignored:

```
SONIOX_API_KEY=...
ACCESS_CODE=...
```

`ACCESS_CODE` must be at least 24 characters, or the Worker refuses every request. Make one with `openssl rand -hex 16`.

## Deploy

Set the two secrets once, then deploy:

```sh
npx wrangler@4 secret put SONIOX_API_KEY
npx wrangler@4 secret put ACCESS_CODE
npm run deploy
```

To open the site on a phone without typing the code, use a link with the code once: `https://<worker-url>/#code=<code>`. The page saves the code and removes it from the address bar.

The Worker name in `wrangler.jsonc` sets the public URL and the origin where the access code is saved. Do not rename it.

## Install on iPhone

1. Open the page in Safari and tap Install in the small row at the bottom, then Copy access code.
2. In Safari, tap Share, then Add to Home Screen.
3. Open Suflyor from the Home Screen and paste the code if it asks.

An installed Home Screen app may not see what Safari saved, so the code may have to be pasted once.

## Limits

- The screen must stay on. Locking it stops the microphone.
- The app must stay in front. Switching away stops the microphone.
- Anyone with the access code can spend the Soniox balance.
- There are no reply suggestions.
- It uses the microphone only, so it hears the room, not system audio.

## Privacy

Microphone audio goes directly from the page to Soniox. Transcripts are not saved. Check your local rules on recording and your employer's policies before using it on a call.

The earlier macOS app and Chrome extension are in git history, last at commit `b5ca781`.
