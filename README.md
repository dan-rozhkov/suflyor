# Suflyor

A small macOS app that sits next to a call, translates what the other person says from English to Russian in real time, and suggests what to reply. No bot joins the call.

- System audio is captured by a small Swift ScreenCaptureKit helper.
- [Soniox](https://soniox.com) streams recognition and translation.
- [OpenCode](https://opencode.ai) generates reply suggestions, using an optional `.md` file as context.

## Requirements

Apple silicon Mac, macOS 14 or later, Xcode command line tools, Node.js.

## Run

```sh
npm install
node node_modules/electron/install.js   # only if the Electron binary was not downloaded
infisical run --env=dev -- npm run dev
```

Keys come from Infisical, the project is linked in `.infisical.json`. Without Infisical, paste the keys in Settings or use `.env.example` as a template for `.env`.

macOS asks for Screen Recording permission on first start. It is needed to capture system audio.

To try the interface without keys or audio:

```sh
SUFLYOR_DEMO=1 npm run dev
```

## Microphone

With the Microphone switch on (Settings, on by default), Suflyor also listens to your microphone while a session runs, so reply suggestions know what you already said. Your words appear in the suggestion prompt as `ME:` lines. They are not shown in the translation feed.

- It is a second Soniox stream (transcription only, no translation), so audio cost doubles while a session runs. Turn the switch off to avoid it.
- Without headphones the microphone also hears the speakers. An echo guard drops mic text that repeats what the other side said in the last 15 seconds.
- Some echo can still get through, so headphones are recommended.
- macOS asks for Microphone permission on first use. If you decline, translation keeps working and a notice says suggestions can't hear you. You can allow it later in System Settings, Privacy & Security, Microphone.
- The Microphone switch in Settings turns the microphone on or off for all calls. During a call, the microphone button next to the suggest button mutes it for this call only: the mute is not saved, and the next call starts unmuted. The button shows the real state, so after a failure it shows off, and a click retries. It is hidden while the switch is off.
- A microphone problem never stops translation: only the microphone part stops, with a notice.

## Chrome extension (prototype)

A small Chrome extension that shows live EN to RU translation of one browser tab in the side panel. It is a test of tab audio capture, not a replacement for the app.

```sh
npm run build:extension
```

1. Open chrome://extensions, turn on Developer mode, click Load unpacked and pick `out/extension`.
2. Open the call tab and click the Suflyor toolbar icon. The side panel opens.
3. Paste your Soniox key and press Start.

Limits:

- Chrome only.
- The key is held in memory. Chrome asks for it again after a browser restart.
- Closing the panel stops capture.
- No reconnect: if the connection drops, the session stops.
- No reply suggestions and no microphone.

## iPhone (prototype)

A web page for iPhone Safari that listens to the phone microphone and shows live EN to RU translation. It is a test, not a replacement for the app.

The page runs on a small Cloudflare Worker. The Worker keeps your Soniox key and hands the phone a key that works for 60 seconds, so the main key never reaches the phone. The Worker asks for an access code before it gives out a key.

The access code must be at least 24 characters, or the Worker refuses every request. Make one with `openssl rand -hex 16` (32 characters).

Deploy:

```sh
npx wrangler@4 secret put SONIOX_API_KEY --config src/mobile/wrangler.jsonc
npx wrangler@4 secret put ACCESS_CODE --config src/mobile/wrangler.jsonc
npm run deploy:mobile
```

Open `https://<your-worker>.workers.dev/#code=<your access code>` once on the phone. The page saves the code and removes it from the address. After that, open the plain address.

Limits:

- The screen must stay on and Safari must stay in front. Locking the phone stops the microphone.
- The session stops when the phone locks or Safari goes to the background. Tap Start to continue: the text stays on the screen.
- Anyone with the access code can spend your Soniox balance.
- No reply suggestions.

## Privacy

Audio from the system and, if enabled, the microphone is sent to Soniox, and transcripts and your context file are sent to OpenCode. Transcripts are not saved to disk. The iPhone page sends microphone audio directly to Soniox. Check your local rules on recording and your employer's policies before using it on a call.

The window asks macOS to exclude it from screen capture, but this is not guaranteed. Test it with your call app before sharing your screen.

## Context file

Pick a Markdown file in the app. Its full text goes to OpenCode for reply suggestions. A part of it also goes to Soniox as `context`, so names and terms are transcribed and translated correctly. See `docs/context-example.md`.

- `## Call` (or `General`): bullets `- key: value`, up to 8 pairs.
- `## Terms` (or `Glossary`): bullets `- Nimbus` for a term, `- manual tests = ручные тесты` for a fixed translation (`=`, `=>`, `→` and `->` work). `- Nimbus = Nimbus` keeps a name untranslated.
- Everything else is free text.

Soniox accepts about 8,000 tokens of context, so the text is cut to fit (Cyrillic counts double). Call pairs and terms are kept first, and the free text is trimmed. The context is read when a session starts or reconnects.
