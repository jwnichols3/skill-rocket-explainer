# Rocket Explainer

Turn a meeting, a paper, a folder or a repo into an explainer in a visual style you've tuned: a narrated **video**, a **slide deck**, a one-page **visual**, or a **briefing doc**.

![Frames from the explainer Rocket Explainer made of itself](https://raw.githubusercontent.com/jwnichols3/skill-rocket-explainer/main/docs/readme/hero.jpg)

<sub>Frames from the video this project made of its own design docs, in the seed Hitchhiker's Guide style. See all four outputs, made from the same sources, in [`docs/dogfood/`](docs/dogfood/).</sub>

## Quick start

You need macOS or Linux, Node.js 24+, ffmpeg, and Claude Code signed in (details under [Requirements](#requirements)).

**1. Install.**

```bash
curl -fsSL https://github.com/jwnichols3/skill-rocket-explainer/releases/latest/download/install.sh | sh
```

**2. Set up.** This checks your machine, prints a fix for anything missing, starts the app and opens its Setup page in your browser. Choose how to reach Claude (subscription or Bedrock) and a voice there.

```bash
explainer setup
```

**3. Pick a style.** The app ships with one, Hitchhiker's Guide. To make your own, go to **Styles > New style**, describe the look, and tune it from a ~10 second sample (see [What it does](#what-it-does)).

**4. Make an explainer.** In Claude Code, name your sources, the output and the style:

```text
/explainer @notes/options-call.md as a video in the Hitchhiker's style: the three options and which one we picked
```

The app opens on the new explainer. It reports what it found in your sources and proposes a plan. Comment on the plan or approve it, then build.

**5. Iterate.** Watch the result, pin comments to scenes or moments, and re-render. Only the scenes you commented on are redone.

Later: `explainer open` reopens the app, `explainer stop` stops it, `explainer doctor` re-checks your machine. Typing `/explainer` on its own opens the app's New page.

## What it does

- **Styles are the product.** A style is a named, versioned asset: palette, type, motion, camera, tone and voice, stored as a [DESIGN.md](https://github.com/google-labs-code/design.md)-style file with sections per output type. You make one by describing it, or by pointing at something it should look like. The app renders a ~10 second sample; you watch it, comment ("contrast too low", "voice too fast") and re-render until it's right, then save.
- **Share styles.** Clone a style to make a variant. **Export** saves it as one `.style.json` file (instructions, voice, model and reference images; not the samples), which **Import style** on another machine turns back into a style.
- **One command to start.** Type `/explainer` in Claude Code. Name your sources and it creates the explainer for you; otherwise it opens the app's New page with whatever you gave it.
- **Steer, then build.** The app reports what it found in your sources and proposes a plan for you to react to. Then it writes the script, narrates it and renders it.
- **Comments re-render only what they touch.** Pin a comment to a scene or a moment in the video. The next round revises and re-renders just those scenes and reuses the rest, narration included.
- **Runs on your machine.** It's a local web app (127.0.0.1, or behind your own reverse proxy on a dev box). Rendering uses headless `claude -p`, so your Claude Code session isn't tied up.
- **See what it cost.** Each explainer shows its tokens and an estimated cost per job.

## Requirements

- macOS or Linux, Node.js 24+ (with npm), ffmpeg.
- **Claude Code**, signed in with a Claude subscription, or using **Amazon Bedrock** through an AWS profile. Each explainer can choose which; the Bedrock one discovers your inference profiles.
- **A voice**, one of:
  - **Amazon Polly** (the default): needs AWS credentials.
  - **Kokoro**: free and local, works offline after a one-time install ([below](#offline-narration-kokoro)).
  - **ElevenLabs**: paste an API key in Settings > Voices.
- Chromium for deck, doc and visual exports: Playwright's (`npx playwright install chromium`), or your installed Google Chrome.

`explainer setup` and `explainer doctor` check all of this and print a fix for anything missing.

## Install

```bash
curl -fsSL https://github.com/jwnichols3/skill-rocket-explainer/releases/latest/download/install.sh | sh
explainer setup
```

What goes where:

| What | Where |
| --- | --- |
| The app, one folder per version | `~/.rocket-explainer/app/<version>/`, with `app/current` pointing at the one in use |
| The `explainer` command | `~/.local/bin/explainer` (override with `EXPLAINER_BIN_DIR`); the installer warns if it is not on your `PATH` |
| The `/explainer` skill for Claude Code | `~/.claude/skills/explainer/SKILL.md` (or under `$CLAUDE_CONFIG_DIR`) |
| Your settings, styles and explainers | `~/.rocket-explainer/` (override with `EXPLAINER_HOME`); the installer never touches them |

Installer options (environment variables):

- `EXPLAINER_VERSION=v0.2.0` installs that release instead of the latest.
- `EXPLAINER_TARBALL=/path/rocket-explainer-0.2.0.tar.gz` installs from a downloaded release tarball (offline installs).

Re-running is safe: an installed version is only re-linked.

### Update

Settings > About > **Check for update** compares your version with the latest GitHub release and offers **Install vX.Y.Z**, then **Restart now**. From a terminal, re-run the install command, then `explainer restart`.

A newer version installs alongside the old one and becomes `current`. The update check sends a GitHub token when it has one (`GITHUB_TOKEN`, else `gh auth token`), which helps with GitHub's rate limit.

### Uninstall

```bash
explainer stop
rm -rf ~/.rocket-explainer/app ~/.local/bin/explainer ~/.claude/skills/explainer
```

That leaves your data. To remove it as well: `rm -rf ~/.rocket-explainer`. Old versions can be deleted one at a time from `~/.rocket-explainer/app/` (keep the one `current` points at).

## Offline narration (Kokoro)

Kokoro is a free local TTS (82M params, Apache-2.0 weights) with native word timings. It needs [uv](https://docs.astral.sh/uv/) and a one-time install (~1.2 GB: Python, torch, model, English voices) into `~/.rocket-explainer/cache/kokoro`:

```bash
node ~/.rocket-explainer/app/current/src/providers/kokoro/install.ts
```

Then pick Kokoro in Settings > Voices, or as a style's voice. After that it runs fully offline. Delete `~/.rocket-explainer/cache/kokoro` to uninstall.

## Costs and licences

**This project** is MIT-licensed ([LICENSE](LICENSE)). It calls services and tools that have their own terms:

- **Video renderers.** Choose one in Settings > Rendering.
  - [HyperFrames](https://github.com/heygen-com/hyperframes) is the **default**. It is Apache-2.0, and its compositions use GSAP, which has its own no-charge licence.
  - **[Remotion](https://www.remotion.dev) is optional and is not free for every organisation.** It is free for individuals, for companies of up to 3 people, for non-profits, and for evaluation. Larger companies need a Remotion Company License. This app calls Remotion's renderer from code, which Remotion classes as **"automation"**: per-render pricing with a monthly minimum. See the [license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md), [FAQ](https://www.remotion.dev/docs/license/faq) and [pricing](https://www.remotion.pro/license) before you switch to Remotion at work.
- **Claude.** Usage counts against your Claude subscription, or is billed by AWS when you run on Bedrock.
- **Narration.** Amazon Polly is billed by AWS per character. ElevenLabs is billed on your ElevenLabs plan. Kokoro is free.

**Cost estimates.** Each explainer's Usage panel shows tokens and an estimated cost per job.

- The Claude figure is Claude Code's own, at API list prices, so on a subscription it is not what you pay.
- Polly is estimated at list price.

## Develop

Requires Node 24+ and ffmpeg.

```bash
npm install
node bin/explainer.ts start     # http://127.0.0.1:4870
node bin/explainer.ts doctor
node bin/explainer.ts restart   # stop + start, e.g. after an update
npm test                        # typecheck + API tests + Playwright (fake providers)
npm run test:live               # opt-in contract runs against real providers
```

Data lives in `~/.rocket-explainer/` (override with `EXPLAINER_HOME`).

Design notes: [renderers](docs/renderers.md), [agent surfaces](docs/agent-surfaces.md), [adding a TTS provider](docs/adding-a-tts-provider.md), [style helpers](docs/style-helpers.md), and the decision records in [`docs/adr/`](docs/adr/). The bakeoffs behind the defaults are in [`docs/bakeoffs/`](docs/bakeoffs/).

## Release

Bump `version` in `package.json`, commit, then push a matching tag (`git tag v0.2.0 && git push origin v0.2.0`). The release workflow checks the tag matches, builds the tarball with `scripts/package.sh` (bin, src, web, seed, templates, skill, package files, LICENSE, README) and publishes it with `install.sh` as a GitHub release.

`npm run public-readiness` scans for personal paths, keys and account ids. List your own identifiers, one per line, in an untracked `.public-readiness-denylist` to have them flagged too.

## License

[MIT](LICENSE)
