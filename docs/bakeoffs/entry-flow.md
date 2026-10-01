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
