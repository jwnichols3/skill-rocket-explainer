# skill-rocket-explainer

A `/explainer` skill: turn a meeting, paper, or folder into an explainer (video, animation, deck, one-pager, or briefing doc) in a reusable visual style.

Status: intent stage. See `docs/intent/`.

## Install

Requires Node 24+ (with npm) and ffmpeg. One command:

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

Installer options (environment variables): `EXPLAINER_VERSION=v0.2.0` installs that release instead of the
latest; `EXPLAINER_TARBALL=/path/rocket-explainer-0.2.0.tar.gz` installs from a downloaded release tarball
(offline installs, or while the repo is private). Re-running is safe: an installed version is only re-linked.

### Update

Settings > Version > **Check for update** compares your version with the latest GitHub release and offers
**Install vX.Y.Z**, then **Restart now**. From a terminal, re-run the install command, then `explainer restart`.
A newer version installs alongside the old one and becomes `current`. The update check sends a GitHub token
when it has one (`GITHUB_TOKEN`, else `gh auth token`), which it needs while the repo is private.

### Uninstall

```bash
explainer stop
rm -rf ~/.rocket-explainer/app ~/.local/bin/explainer ~/.claude/skills/explainer
```

That leaves your data. To remove it as well: `rm -rf ~/.rocket-explainer`. Old versions can be deleted
one at a time from `~/.rocket-explainer/app/` (keep the one `current` points at).

## Release

Bump `version` in `package.json`, commit, then push a matching tag (`git tag v0.2.0 && git push origin v0.2.0`).
The release workflow checks the tag matches, builds the tarball with `scripts/package.sh` (bin, src, web, seed,
templates, skill, package files, LICENSE, README) and publishes it with `install.sh` as a GitHub release.
`npm run public-readiness` scans for personal paths, keys and account ids; list your own identifiers, one per line,
in an untracked `.public-readiness-denylist` to have them flagged too.

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

## Offline narration (Kokoro)

Kokoro is a free local TTS (82M params, Apache-2.0 weights) with native word timings. It needs [uv](https://docs.astral.sh/uv/) and a one-time install (~1.2 GB: Python, torch, model, English voices) into `<data dir>/cache/kokoro`:

```bash
node src/providers/kokoro/install.ts   # then set providers.tts to "kokoro"
```

After that it runs fully offline. Delete `<data dir>/cache/kokoro` to uninstall.
