# 1. Entry flow for /explainer

Status: **Accepted** by Rocket, 2026-10-01 (the hybrid). Evidence: `docs/bakeoffs/entry-flow.md`.
Date: 2026-10-01

## Context

`/explainer` can either gather input in Claude Code (A: chat gathers, web iterates) or hand straight to the
web app (B: web does everything). Rocket leans toward a single interface. The app may run on a dev box behind
a reverse proxy.

## Decision

B is the base flow, with A's handoff as a fast path, and the skill asks no questions in chat:
- No sources in the request: open `/new`, prefilled with any topic, style and type given.
- Sources named in the request (`@` files, links, connector items): run `explainer new` and open the
  explainer on its source report. The skill fetches connector sources itself and passes them as files.

## Consequences

- One interface for every decision after the command; works through the reverse proxy.
- `@` completion and the session's connectors still help when the user uses them.
- The New page needs style and type fields, and the CLI must print the proxy URL when one is configured.
- #21 implements the winning flow as the user-level skill.
