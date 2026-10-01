---
name: explainer
description: Make an explainer (narrated video, deck, briefing doc or one-pager visual) of anything - a meeting, a paper, a folder, a repo - in one of your styles. Use when the user says "make an explainer", "explain this as a video/deck", or runs /explainer. Prototype B of the entry-flow bakeoff - web does everything.
argument-hint: "[topic] [style] [video|deck|doc|visual]"
---

# /explainer (prototype B: web does everything)

Make sure the Rocket Explainer app is set up and running, then open its New explainer page. All input
happens there. Ask nothing in chat.

1. Run `explainer status`. If it is not running, run `explainer start`. If `explainer` is not found or start
   fails, run `explainer doctor` and show its fixes, then stop.
2. If `$ARGUMENTS` holds a topic, style or output type (`video`, `deck`, `doc`, `visual`), pass them through as
   query parameters so the page is prefilled. Files the user `@`-mentioned in this message become `source`
   parameters (absolute paths):

   ```bash
   explainer open "/new?brief=<url-encoded topic>&style=<style>&type=<type>&source=<abs path>"
   ```

   With no arguments: `explainer open /new`.
3. Print the URL it opened and stop.
