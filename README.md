# Suflyor

A web page that listens to the room through the microphone and shows live translation. The original and translation languages are set in Settings (English to Russian by default, or the original only). It runs in a browser and installs on the iPhone Home Screen. No bot joins the call.

## How it works

- The page records the microphone and sends the audio straight to [Soniox](https://soniox.com), which streams recognition and translation back.
- A small Cloudflare Worker (`src/worker.ts`) holds the Soniox API key. The page sends the access code to the Worker and gets a short-lived Soniox key. It lasts 60 seconds, which is enough to open the stream.
- Reply suggestions go through the same Worker. The page sends the last lines of the original text and the call notes to `POST /api/suggest`. The Worker adds the OpenCode key and streams the answer back. The key never reaches the page.
- Call summaries go through the same Worker. After Stop, the page sends the original text of that call and the call notes, with the languages to write in to `POST /api/summary`. The Worker asks OpenCode for the notes and returns them to the page.
- Chapters go through the same Worker. While a call runs, the page sends the text of the open chapter, as shown in the feed, to `POST /api/chapters`, and the Worker asks OpenCode for chapter titles. Only that text is sent, never the call notes.
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

1. Open the page in Safari, tap Share, then Add to Home Screen.
2. Open Suflyor from the Home Screen and enter the access code.

An installed Home Screen app may not see what Safari saved, so the code may have to be pasted once.

In the installed app, buttons give a short haptic tap on iPhone and a short vibration on Android.

iOS reads the status bar style when the app is added. If the clock is hard to read after an update, remove the app from the Home Screen and add it again.

## Reply suggestions

While a call runs, the round sparkle button in the dark bar asks for replies. It needs at least one finished line of the original. The first reply shows, and `2 more` shows the rest. Tap a reply to copy it. The model hears the whole room and does not know who spoke, so it guesses from the words.

## Chapters

Every paragraph in the feed starts with the time it appeared (24-hour clock, to the second). During a call the page also splits the talk into chapters with short titles in the feed language. Small dashes show at the right edge of the feed, one per chapter. Tap them on a phone, or hover on a computer, to open the list. Tap a chapter to scroll to it. `Latest` scrolls back to the end of the feed. A chapter shorter than about 20 seconds of speech is joined to the one before it, except the first chapter of a call. Closed chapters do not change. Only the last chapter is sent again as the call goes on, so a long call costs the same for each request. If a request fails, the page stays quiet and tries again later.

## Summary and transcript

After Stop, the page saves the call as a meeting on this device and writes the notes by itself. The meeting opens on its Notes tab. While the notes are written you see a short wait state. If it fails, `Try again` runs it once more. The notes are in the feed language: a title that says what the call was about and what kind of meeting it was (`Subject | Check-in`); the date and length, measured by the page; the people who took part, only when the call or the call notes named them; action items, each with an owner only when the call named one, the task in bold and a short line of context when the call gave one; an overview of the main points; then one section for each topic, with the topics taken from what was said. Each point is one or two sentences with the numbers, conditions and open questions the call gave. The transcript has no speaker labels, so the notes never number speakers: they name a person only when the call did, and otherwise say which side a point came from only when the words show it. Key numbers are bold. The Worker drops any person that is in neither the transcript nor the call notes, and clears an owner the transcript never named: the call notes say who attended, not who took a task. `Copy notes`, at the end of the notes, copies them as markdown: an H1 title, Date, Duration and People, an H4 section with `- [ ]` action items, then H2 sections for the overview and each topic. The notes stay with the meeting until you delete it. A call over about two hours is summarized from its latest part, and the notes say so.

The three-dot menu has `Download transcript` when no call is running. It saves the text of the feed as a `.md` file: chapter titles, the time and text of each paragraph as shown in the feed, and the original as a quote when the call was translated. The meeting notes are not in the file. On a phone it opens the share sheet, where `Save to Files` keeps the file.

## Call notes

Open the three-dot menu and choose Settings when no call is running to pick the original language, turn translation on or off and pick the translation language. The choice is saved on this device and applies from the next Start. The two languages are never the same: picking one that the other already has swaps them.

Tap Notes when no call is running. Type names, terms and notes, or attach a `.md` or `.txt` file (up to 1 MB). The text stays on this device. Soniox uses it for recognition and translation, and the reply model uses it for suggestions. The first part is cut to fit the Soniox limit. See the format in [docs/context-example.md](docs/context-example.md): a `Call` section with `- key: value` lines, a `Terms` section with `- term` or `- term = перевод` lines, and free text for the rest.

## Limits

- The screen must stay on. Locking it stops the microphone.
- The app must stay in front. Switching away stops the microphone.
- Anyone with the code can spend the Soniox balance. They can also spend the OpenCode balance.
- Reply suggestions need the `OPENCODE_API_KEY` secret. Without it the button does not work.
- Notes are cut to 100,000 characters. Soniox gets a shorter version of them.
- Timestamps and chapters live only while the page is open. A reload clears them, as it clears the feed.
- Chapters need the same `OPENCODE_API_KEY` secret. Without it the dashes do not appear.
- It uses the microphone only, so it hears the room, not system audio.

## Privacy

Microphone audio goes directly from the page to Soniox. Transcripts are not saved. The call notes are saved in this browser only. They go to Soniox with each session. When you ask for replies, the Worker sends the notes and the last lines of the original to OpenCode. Chapters work differently: during a call, without any tap, the text of the open chapter goes to OpenCode through the Worker. The call notes is not part of it. Check your local rules on recording and your employer's policies before using it on a call.

The earlier macOS app and Chrome extension are in git history, last at commit `b5ca781`.
