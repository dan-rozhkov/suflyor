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
