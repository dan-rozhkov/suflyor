# Suflyor

A web page that listens to the room through the microphone and shows live English to Russian translation. It runs in a browser and installs on the iPhone Home Screen. No bot joins the call.

## How it works

- The page records the microphone and sends the audio straight to [Soniox](https://soniox.com), which streams recognition and translation back.
- A small Cloudflare Worker (`src/worker.ts`) holds the Soniox API key. The page sends the access code to the Worker and gets a short-lived Soniox key. It lasts 60 seconds, which is enough to open the stream.
- Reply suggestions go through the same Worker. The page sends the last lines of English text and the call context to `POST /api/suggest`. The Worker adds the OpenCode key and streams the answer back. The key never reaches the page.
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
OPENCODE_API_KEY=...
```

`ACCESS_CODE` must be at least 24 characters, or the Worker refuses every request. Make one with `openssl rand -hex 16`.

## Deploy

Set the secrets once, then deploy:

```sh
npx wrangler@4 secret put SONIOX_API_KEY
npx wrangler@4 secret put ACCESS_CODE
npx wrangler@4 secret put OPENCODE_API_KEY
npm run deploy
```

`OPENCODE_API_KEY` is optional. Without it the site works, and the reply button says suggestions are not set up.

To open the site on a phone without typing the code, use a link with the code once: `https://<worker-url>/#code=<code>`. The page saves the code and removes it from the address bar.

The Worker name in `wrangler.jsonc` sets the public URL and the origin where the access code is saved. Do not rename it.

## Install on iPhone

1. Open the page in Safari and tap Install in the small row at the bottom, then Copy access code.
2. In Safari, tap Share, then Add to Home Screen.
3. Open Suflyor from the Home Screen and paste the code if it asks.

An installed Home Screen app may not see what Safari saved, so the code may have to be pasted once.

## Reply suggestions

While a call runs, the round sparkle button in the dark bar asks for replies. It needs at least one finished English line. The first reply shows, and `2 more` shows the rest. Tap a reply to copy it. The model hears the whole room and does not know who spoke, so it guesses from the words.

## Call context

Tap Context when no call is running. Type names, terms and notes, or attach a `.md` or `.txt` file (up to 1 MB). The text stays on this device. Soniox uses it for recognition and translation, and the reply model uses it for suggestions. The first part is cut to fit the Soniox limit. See the format in [docs/context-example.md](docs/context-example.md): a `Call` section with `- key: value` lines, a `Terms` section with `- term` or `- term = перевод` lines, and free text for the rest.

## Limits

- The screen must stay on. Locking it stops the microphone.
- The app must stay in front. Switching away stops the microphone.
- Anyone with the code can spend the Soniox balance. They can also spend the OpenCode balance.
- Reply suggestions need the `OPENCODE_API_KEY` secret. Without it the button does not work.
- Context is cut to 100,000 characters. Soniox gets a shorter version of it.
- It uses the microphone only, so it hears the room, not system audio.

## Privacy

Microphone audio goes directly from the page to Soniox. Transcripts are not saved. The call context is saved in this browser only. It goes to Soniox with each session. When you ask for replies, the Worker sends the context and the last English lines to OpenCode. Check your local rules on recording and your employer's policies before using it on a call.

The earlier macOS app and Chrome extension are in git history, last at commit `b5ca781`.
