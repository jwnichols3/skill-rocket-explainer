# Intent: Rocket Explainer (`/explainer`)

Status: draft intent 2026-10-01, open questions below, not yet a spec
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

## Before the spec

Research whether something like this already exists to leverage: explainer skills, "show me"-style
visual skills (which skew to technical diagrams), and agentic video tools.

## Open questions

See the Q&A section, filled in as we cycle.
