# skill-rocket-explainer

A `/explainer` skill: turn a meeting, paper, or folder into an explainer (video, animation, deck, one-pager, or briefing doc) in a reusable visual style.

Status: intent stage. See `docs/intent/`.

## Develop

Requires Node 24+ and ffmpeg.

```bash
npm install
node bin/explainer.ts start     # http://127.0.0.1:4870
node bin/explainer.ts doctor
npm test                        # typecheck + API tests + Playwright (fake providers)
npm run test:live               # opt-in contract runs against real providers
```

Data lives in `~/.rocket-explainer/` (override with `EXPLAINER_HOME`).

## Offline narration (Kokoro)

Kokoro is a free local TTS (82M params, Apache-2.0 weights) with native word timings. It needs [uv](https://docs.astral.sh/uv/) and a one-time install (~1.2 GB: Python, torch, model, English voices) into `<data dir>/cache/kokoro`:

```bash
node src/providers/kokoro/install.ts   # then set providers.tts to "kokoro"
```

After that it runs fully offline. Delete `<data dir>/cache/kokoro` to uninstall.
