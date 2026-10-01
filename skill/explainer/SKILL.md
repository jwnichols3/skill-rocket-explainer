---
name: explainer
description: Make an explainer (narrated video, slide deck, briefing doc or one-pager visual) of anything - a meeting, a paper, a folder, a repo, an email thread - in one of the user's tuned styles, with the Rocket Explainer app. Use when the user says "make an explainer", "explain this as a video/deck/doc/one-pager", "turn this into an explainer", or runs /explainer.
argument-hint: "[topic] [@sources] [style] [video|deck|doc|visual]"
---

# /explainer

Hand the request to the Rocket Explainer web app, which does sources, style, plan, build and iteration.
**Never ask the user questions in chat.** Whatever is missing gets asked in the app.

## 1. Make sure it's installed, set up and running

Run `explainer status`.
- `command not found`: Rocket Explainer isn't installed. Tell the user to install it from the latest release:
  `curl -fsSL https://github.com/jwnichols3/skill-rocket-explainer/releases/latest/download/install.sh | sh`
  Then stop.
- Output mentions `setup incomplete`: run `explainer setup`. It starts the app and opens the Setup page.
  Tell the user to finish setup there and run `/explainer` again. Then stop.
- `not running`: the next command starts the app.

## 2. Read the request

From `$ARGUMENTS` and the user's message, pick out:
- **topic**: what to explain and from what angle;
- **sources**:
  - files and folders the user `@`-mentioned or named (resolve each one to an absolute path);
  - links;
  - things only your connectors reach ("the email thread about X", "yesterday's meeting notes");
- **style**: a style name. `explainer styles` lists them; match loosely;
- **output type**: `video`, `deck`, `doc` or `visual`. Accept "slides" for deck, "briefing" for doc and
  "one-pager" for visual. The default is video.

## 3a. The request names sources: create it directly

1. For connector sources, fetch the content now with your own tools (the app's agent has no connectors).
   Write each item to `~/.rocket-explainer/inbox/<short-slug>.md` and use that file as the source. If one
   can't be reached, say so in one line and carry on with the rest.
2. Run:
   ```bash
   explainer new --brief "<topic and angle>" --source "<abs path or url>" [--source ...] [--style "<name>"] [--type <type>]
   ```
   The command creates the explainer, starts gathering sources and opens the browser on the source report.

## 3b. No sources named: open the New page

```bash
explainer open "/new?brief=<url-encoded topic>&style=<style>&type=<type>"
```
Leave out any parameter you don't have. With nothing at all, run `explainer open /new`.

## 4. Finish

Print the URL the command printed, and say in one line what happens next in the app ("the source report is
running", or "add sources on the New page"). Then stop. Do not watch jobs from chat.
