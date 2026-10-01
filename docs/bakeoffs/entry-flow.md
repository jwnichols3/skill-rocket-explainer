# Bakeoff: entry flow (#3)

How does Rocket start an explainer?

- **A. Chat gathers, web iterates.** `/explainer` collects the topic, sources (with `@` file completion and
  the session's connectors), style and output type in Claude Code. It then creates the explainer through
  the API and opens the web app on it.
- **B. Web does everything.** `/explainer` only makes sure the app is set up and running, then opens the
  web app's New explainer page, where all input happens.

Both prototypes use the same HTTP API, through the `explainer` CLI. The bakeoff changes the client, not the
core.

## Judging criteria (written before judging)

Each criterion is scored 1-5, where 5 is best. Weights reflect Rocket's stated preference for a single
interface and the reverse-proxy use case.

| # | Criterion | Weight | What a 5 looks like |
|---|---|---|---|
| 1 | Steps to first render | 2 | Fewest user actions from typing `/explainer` to a sample or plan rendering. Both a fully specified request and a bare `/explainer` are counted. |
| 2 | Source-picking ergonomics | 2 | Adding files, folders, links and notes is fast and hard to get wrong, and misreads are easy to fix. |
| 3 | Connector reach | 1 | Sources behind the user's connectors (mail, docs, chat) can be used without copy-paste. |
| 4 | Works through the reverse proxy | 2 | Works the same when the app runs on a dev box and the browser is on the Mac. |
| 5 | Implementation cost | 1 | Little code to build and maintain, with few moving parts across two surfaces. |
| 6 | Single-interface feel | 2 | One place to look and act, with no context switch mid-task. |

Total = sum of score x weight, out of 50.

Evidence, collected in `docs/bakeoffs/entry-flow/`:
- for each flow, a walkthrough with screenshots of the web side (and the chat transcript for A);
- an action count for each flow, covering a bare `/explainer` and a fully specified `/explainer <topic> <style> <type>`.

## What was built

- `prototypes/entry-flow/chat/SKILL.md` (A) and `prototypes/entry-flow/web/SKILL.md` (B). Both are complete
  user-level skills named `explainer`.
- `explainer new` (CLI). It creates an explainer through the API, starts the source report and opens it. A
  hands off through it.
- `explainer styles` (CLI). It lists style names so the chat flow can offer them.
- `/new?brief=&source=&style=&type=` prefill on the New explainer page. B hands off through it.

## Runs (2026-10-01)

Each run was a real `claude -p` session (Sonnet 5.5, low effort) in a scratch project, with the prototype as
a project skill, against a local app on fake render providers. The runs measure the entry flow, not rendering.

| Run | Prompt | Result | Time | Cost |
|---|---|---|---|---|
| A, fully specified | `/explainer @docs/intent/explainer.md @docs/research/prior-art.md as a deck in the Hitchhiker's style: what this project is and why it exists` | Explainer created with 2 path sources, style matched, type deck, report running; printed the URL | 11 s | $0.14 |
| B, bare | `/explainer` | Opened `/new` | 7 s | n/a |
| B, fully specified | same as A | Opened `/new` prefilled with brief, both sources and type. **The style didn't carry:** the skill guessed the slug `hitchhikers`, which doesn't match "Hitchhiker's Guide", and the New page has no style field to show the miss | 10 s | n/a |

A first A run in a mis-built scratch project referred to `@` files that didn't exist. The skill refused to
guess paths and asked, which was the right behaviour.

Screenshots:
- `entry-flow/a-handoff.png`: A lands on the explainer with the report done, the style and Deck selected,
  and "Propose a plan" next.
- `entry-flow/b-prefilled.png`: B's New page, prefilled.
- `entry-flow/b-after-gather.png`: B after Gather sources, with no style selected.
- `entry-flow/b-bare-source-picker.png`: B with no arguments, typing a source path. The autocomplete list is a native popup and does not show in headless screenshots.

## Action counts, `/explainer` to the first render

The first render is the build after plan approval. Propose plan, approve and build are 3 actions in both flows.

| | Fully specified | Bare `/explainer` |
|---|---|---|
| A | 1 (command) + 3 = **4** | 1 + 1 (one chat form: topic, sources with `@`, style, type) + 3 = **5** |
| B | 1 + 1 (Gather) + 1 (style, when the guess misses) + 3 = **5-6** | 1 + 1 (brief) + 1-2 (sources) + 1 (Gather) + 1 (style) + 0-1 (type) + 3 = **8-10** |

## Scores

| Criterion (weight) | A | B | Why |
|---|---|---|---|
| Steps to first render (2) | 5 | 3 | See the counts above. A's single chat form beats B's typed form. |
| Source-picking ergonomics (2) | 5 | 3 | `@` completion is fast and familiar, and it handles folders. B's autocomplete works but is a datalist, with no drag-and-drop. |
| Connector reach (1) | 5 | 1 | A's chat session uses the user's connectors, fetches the content and passes it as a file. B depends on the app's agent, and the Claude surface deliberately runs with `--strict-mcp-config` (no MCP), so connector sources are not found. |
| Works through the reverse proxy (2) | 3 | 5 | B: the browser on the Mac, and paths autocompleted on the dev box where the app runs. A works only if Claude Code runs on the same machine as the app. Its `@` paths are local to the chat, and the printed URL is loopback (fixable by printing the proxy URL). |
| Implementation cost (1) | 3 | 5 | The New page is needed either way, for the app's own "New explainer". A adds a chat layer on top; B is a 15-line skill. |
| Single-interface feel (2) | 3 | 5 | A starts in chat and continues in the browser. B is one place throughout. |
| **Total (/50)** | **40** | **38** | |

## Recommendation

**B as the base, with A's fast path. Never ask questions in chat.**

- `/explainer` with no sources in its arguments opens `/new`, prefilled with whatever was given (B). This
  keeps the single interface Rocket prefers and works through the proxy.
- `/explainer` whose message already names sources (`@` files, links, or something a connector reaches)
  creates the explainer directly with `explainer new` and opens it on the source report (A's handoff). That
  keeps `@` completion and connectors for free and gives the 4-action path, with no chat questions.
- The skill fetches connector sources itself and passes them as files, because the app's agent runs without
  MCP.

Two fixes that belong with whichever flow wins:
1. Put style and output-type fields on the New page, so a prefilled guess is visible and fixable. This is
   B's style miss in this run.
2. Have the CLI print the reverse-proxy URL when one is configured, instead of the loopback URL.

Rocket accepted the hybrid on 2026-10-01: `docs/adr/0001-entry-flow.md`.
