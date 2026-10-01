---
name: explainer
description: Make an explainer (narrated video, deck, briefing doc or one-pager visual) of anything - a meeting, a paper, a folder, a repo, an email thread - in one of your styles. Use when the user says "make an explainer", "explain this as a video/deck", or runs /explainer. Prototype A of the entry-flow bakeoff - chat gathers, web iterates.
argument-hint: "[topic] [style] [video|deck|doc|visual]"
---

# /explainer (prototype A: chat gathers, web iterates)

Gather what the explainer needs here in chat, hand it to the Rocket Explainer app, and open the app on it.
Ask only for what is missing. A fully specified request asks nothing.

## 1. Make sure the app is up

Run `explainer status`. If it is not running, run `explainer start`. If `explainer` is not found or start fails,
run `explainer doctor` and show its fixes, then stop.

## 2. Parse the arguments

`$ARGUMENTS` may hold a topic, a style name and an output type in any order. The output type is one of
`video`, `deck`, `doc`, `visual` (also accept "slides", "briefing", "one-pager"). Run `explainer styles` to
see style names, and match the style loosely. Anything left over is the topic.

## 3. Gather what's missing (one AskUserQuestion call, at most 4 questions)

- **What to explain:** the topic and angle, e.g. "the options from this call, for execs".
- **Sources:** files and folders (the user can `@`-mention them, so resolve each to an absolute path),
  links, and things only your connectors can reach ("the email thread about X"). For connector sources,
  fetch the content now with your tools, save it to a file under `~/.rocket-explainer/inbox/`, and pass that
  file as a source. The app's own agent may not have the same connectors.
- **Style:** offer the names from `explainer styles` (most recent first). If there are none, say the app will
  help define one.
- **Output type:** video (default), deck, doc or visual.

Don't ask about anything the user already said, in the arguments or earlier in the conversation.

## 4. Hand off

```bash
explainer new --brief "<topic and angle>" --source "<abs path or url>" [--source ...] [--style "<name>"] --type <type>
```

This creates the explainer, starts gathering sources, and opens the browser on it. Tell the user the URL it
printed, and that the source report, plan and iterations continue in the app. Then stop. Do not watch the
job from chat.
