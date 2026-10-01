# Intent: Rocket Explainer (`/explainer`)

Status: decisions recorded 2026-10-01, ready for to-spec
Source: walk and talk `2026-10-01-explainer-skill` in `~/code/rocket-walk-talk` (local only).
Work-specific details from the walk (the meeting that prompted it, who was on it, internal systems)
are deliberately left out. This repo is the generic version.

## What and why

Explainers are something I'm known for. After a dense 45-minute technical call I wanted an
explainer video of the options discussed. I pointed an agent at the meeting summary and an old video
as a template, and it worked. That should be a skill: take a meeting, a paper, a folder, anything the
agent can reach, and say "make an explainer for that".

The output isn't always a video. It can be an animation, a deck, a one-pager visual, or a
narrative briefing doc.

This is also a focused slice of Rocket Studios, whose videos have so far come out "meh". The
explainer should be clean and standalone. It borrows Rocket Studios concepts but does **not** couple
to it yet.

## Quality bar

High. I have a high bar for visuals: Opus 5 produced meh content, and Fable 5.1 was a dramatic step up.
Opus 5.5 can probably match Fable 5.1, **if the style instructions are refined enough**. That is
why styles are first-class, iterated assets and not a prompt line.

## Shape

- **A user-level skill, `/explainer`.** It is prompt-driven: it always asks for what's missing and
  takes what's given (`/explainer <topic> <style> <type>`), so a few qualifying questions at most.
- **First run does setup**, the way Review Desk does: port, localhost or reverse proxy (for example
  on a dev box).
- **Then it launches a local web app** that runs the whole loop self-contained. Comments trigger a
  re-render through a headless agent (`claude -p`), so I'm not watching tokens spin in my session.
- **Home menu:** new explainer, existing explainers, manage styles, settings.

## Styles (the big deal)

A style is a reusable, named, versioned asset: the style prompt, a sample render, voice settings and
whatever else it takes to reproduce the look.

Flow for **defining a style:**

1. Name it now, or decide later. If later, the agent suggests 2-3 names at save time.
2. Describe it, or point at something it should look like. Example: *Hitchhiker's Guide to the Galaxy
   animations, very smooth transitions, camera movement, highlights of what's appearing, neon
   blue/green, high contrast, lively, room for humor.*
3. Pick a voice: TTS provider, voice/character, and speed / inflection / liveliness if the provider
   supports it. Amazon Polly first; more providers later via settings.
4. It renders a **short sample (~10 s)** that exercises everything: opening sequence, a transition,
   text pop-ups, boxes, a diagram, camera movement.
5. I watch and listen in the browser, comment ("voice is wrong", "contrast too low"), and re-render.
   It can also switch voice or model from a dropdown. Each round refines the style prompt.
6. Save. After that I can clone a style and edit it.

Helpers:

- "Explain this video's style in terms an agent can use", to turn a reference explainer I like into
  style instructions.
- Suggestions on writing good agentic style instructions.

Style ideas: Hitchhiker's Guide, Hollywood/glitzy, Western, secret agent, Matrix, cinematic.

Deferred: style export.

## Creating an explainer

1. **What to explain:** paths, folders, repos, emails, links. Anything the agent's connected
   sources can reach.
2. **Source report:** what it found and didn't find, at a high level, with the option to dig in
   and see what it extracted or summarized. I can steer here.
3. **Style:** pick from my styles.
4. **Model and effort:** dropdown, as in my other tools.
5. **"Here's what I'm thinking of building":** a plan I can react to, then go.
6. **Video-based iteration:** comment, re-render ("more upbeat", "add background music").
7. **Optional hand-off to Review Desk** for a heavier review session, only if Review Desk is
   available. Its absence must never block the explainer.

## Settings

- Model providers and surfaces: Claude subscription, or AWS Bedrock with an AWS profile.
  Self-discovers Bedrock inference profiles. Ambitiously, Codex as well as Claude Code.
- Which surface runs a given explainer is my choice, because sensitive sources may need a narrower
  surface.
- Models and effort levels.
- Voice providers: Polly first, then add providers with API keys ("look around and find these
  provider settings").
- Animation stacks: Remotion first. How others get added is open (probably as a skill).
- Version check: a button that checks GitHub for a newer version and installs it.
- Diagnostics and logs.

## Generic first, specialized later

Build this external and generic first. Later, a private specialized version adds more provider
options. That version is out of scope here, but the generic one should keep its provider layer
pluggable and avoid organization-specific language.

## Out of scope for now

- Tight coupling to Rocket Studios
- Depending on Review Desk
- Style export
- Video-specific skills and models
- The specialized version

## Prior art

`docs/research/prior-art.md` (2026-10-01).
- HeyGen's HyperFrames (Apache-2.0) already does much of the explainer-video pipeline.
- `remotion-dev/skills` covers Remotion guidance, so don't write our own.
- Nobody ships the style loop: describe, sample, comment, re-render, save. **That loop is the
  product.**

## Decisions (2026-10-01, Rocket)

- **v1 delivers all four output types end to end:** video, deck, one-pager visual, briefing doc.
  - **Video:** narrated animation, MP4.
  - **Deck:** HTML slides for style fidelity, plus a `.pptx` export.
  - **Briefing doc:** Markdown rendered to a styled PDF.
  - **Visual:** styled HTML page, exported to PNG.
- **One style, per-type rules:**
  - A style holds a shared identity (palette, type, tone, humor, voice) plus a section per output
    type.
  - The ~10 s video is the main sample.
  - A deck, visual or doc sample renders on demand the first time a style is used for that type.
- **Style file format:** extend Google's DESIGN.md (YAML tokens + prose). Add sections for motion,
  camera, voice and per-type rules.
- **Seed style:** Hitchhiker's Guide, built from the description above only. No reference
  material from work repos enters this repo.
- **Entry flow is a bakeoff:** "chat gathers, web iterates" vs "web does everything". Rocket leans
  toward a single web interface. Build both as thin prototypes, judge the tradeoffs, Rocket picks.
  Known tradeoff:
  - Chat gets `@` file completion and the session's connectors for free.
  - Web-everything needs its own source picker, but it's one interface, and it works through the
    proxy.
- **Animation stack is a bakeoff:** Remotion vs HyperFrames, both behind the stack interface, which
  also proves pluggability.
  - Render the seed style's sample in each, judge, pick the default.
  - Licensing: Remotion is free for Rocket personally, but orgs of 4+ need a paid license, including
    per-render automation fees. HyperFrames is Apache-2.0. This matters for the later specialized
    version.
- **Host:** 127.0.0.1 by default. Setup also accepts a reverse-proxy hostname for a dev box.
  Loopback only, no auth, like Review Desk.
- **Agent surfaces v1:** Claude Code via `claude -p`, on the Claude subscription or on Bedrock with
  a chosen AWS profile (with inference-profile discovery). Codex goes to the backlog behind a
  pluggable surface interface.
- **Model:** Opus 5.5 at high effort by default. Fable 5.1 in the dropdown.
- **TTS v1:**
  - Amazon Polly is the default: voices, plus rate/pitch/volume where the engine supports it.
    Generative has no speech marks, so plan a forced-alignment fallback.
  - Kokoro for local/offline use.
  - ElevenLabs as the API-key provider, built as the template for adding API-based TTS engines.
- **Storage:** styles, settings and explainer projects in a user-level data dir (e.g.
  `~/.rocket-explainer/`). Finished outputs can also be exported to a path you name.
- **App stack:** Node/TypeScript, since both animation stacks are Node. Playwright tests.
- **Install/update:** `install.sh` + GitHub releases, as in Preso Control. The settings "check for
  update" button compares against the latest release.
- **Rocket Studios:** clean slate, borrowing ideas only (one audio clip and component per scene, a
  scene time map). No code copied.
- **Repo:** private now, written as if public: no personal paths, profiles or secrets in code, plus
  a license file.
- **Music:** backlog.
- **Review Desk hand-off:** backlog. It must never block.
- **Acceptance:** dogfood. Explain this repo's own intent and research in the Hitchhiker's style, in
  all four output types.
- **Delivery:** Rocket runs to-spec, then to-tickets, then the agentic dev loop, in a new session.

## Backlog

Codex surface, background music, Review Desk hand-off, style export, more animation stacks (adding
one is probably a skill), video-specific models, and the
specialized version.
