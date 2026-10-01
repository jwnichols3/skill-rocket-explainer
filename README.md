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
