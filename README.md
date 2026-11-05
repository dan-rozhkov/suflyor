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
cp .env.example .env                    # or paste the keys in Settings
npm run dev
```

macOS asks for Screen Recording permission on first start. It is needed to capture system audio.

To try the interface without keys or audio:

```sh
SUFLYOR_DEMO=1 npm run dev
```

## Privacy

Audio is sent to Soniox, and transcripts and your context file are sent to OpenCode. Transcripts are not saved to disk. Check your local rules on recording and your employer's policies before using it on a call.

The window asks macOS to exclude it from screen capture, but this is not guaranteed. Test it with your call app before sharing your screen.

## Context file

Pick a Markdown file in the app. Its full text goes to OpenCode for reply suggestions. A part of it also goes to Soniox as `context`, so names and terms are transcribed and translated correctly. See `docs/context-example.md`.

- `## Call` (or `General`): bullets `- key: value`, up to 8 pairs.
- `## Terms` (or `Glossary`): bullets `- Nimbus` for a term, `- manual tests = ручные тесты` for a fixed translation (`=`, `=>`, `→` and `->` work). `- Nimbus = Nimbus` keeps a name untranslated.
- Everything else is free text.

Soniox accepts about 8,000 tokens of context, so the text is cut to fit (Cyrillic counts double). Call pairs and terms are kept first, and the free text is trimmed. The context is read when a session starts or reconnects.
