# Rocket Explainer: Styles Are the Product

## <a id="s1"></a>What It Is

**In short: one command, any source, four kinds of output.**

Rocket Explainer is a user-level skill called `/explainer`. Point it at a meeting, a paper, a folder or anything else an agent can reach, and say “make an explainer for that.” You can pass `/explainer <topic> <style> <type>` up front. It asks only for what's missing, which is a few qualifying questions at most.

It produces one of four outputs, and v1 is designed to deliver all four end to end: a narrated video (MP4), a deck (HTML slides plus a `.pptx` export), a briefing doc (Markdown rendered to a styled PDF, the format you are reading now) or a single-page visual (a styled HTML page exported to PNG).

The first run handles setup (port, localhost or reverse proxy). After that, `/explainer` launches a local web app that runs the whole loop. Comments trigger re-renders through a headless agent (`claude -p`), so nobody has to sit watching tokens spin in their own session.

The idea came out of a dense 45-minute technical call. An agent was given the meeting summary and an old video as a template, and it produced an explainer that worked. Something that works that well once should be a skill.

- **In:** meeting · paper · folder · repo · …anything the agent can reach
- **Through:** `/explainer`, which asks only what's missing: topic · style · type
- **Out:** one of four output types

| Output | Format | What you get |
|---|---|---|
| Video | MP4 | narrated animation |
| Deck | HTML + PPTX | slides + export |
| **Doc (you are here)** | **PDF** | **Markdown → styled PDF** |
| Visual | PNG | one styled page |

> **Figure 1:** One skill, any reachable source, four output types. Iteration happens in a local web app (comment → re-render via headless `claude -p`), not in your chat session.

## <a id="s2"></a>Why Styles Are the Product

**In short: model output only clears the bar when the style instructions are refined enough.**

The intent doc sets the quality bar in one word: “High.” In the author's experience, Opus 5 produced “meh” content and Fable 5.1 was a dramatic step up. Opus 5.5 can probably match Fable 5.1, but only if the style instructions are refined enough.

That is why a style in Rocket Explainer isn't a line in a prompt. It is a reusable, named, versioned asset: the style prompt, a sample render, voice settings and whatever else it takes to reproduce the look. Styles get iterated, saved, cloned and edited like any other piece of work worth keeping.

One style serves every output type. It holds a shared identity (palette, type, tone, humour, voice) plus a section of rules for each type, so a video, a deck, a doc and a visual made in the same style all look like they belong together.

> **Note:** “Opus 5.5 can probably match Fable 5.1, if the style instructions are
>
> ***REFINED ENOUGH.***”
>
>
> — Rocket Explainer intent doc, “Styles (the big deal)”

| Style · Hitchhiker's Guide (vN) | What it holds |
| --- | --- |
| **Style prompt** | The style instructions (refined here) |
| Sample render | A render that shows the look |
| Voice | Voice settings |
| Per-type rules | Rules for each output type: video, deck, doc, visual |

> **Figure 2:** A style is a named, versioned asset, not a prompt line.

## <a id="s3"></a>Nobody Ships the Loop

**In short: the explainer pipeline is solved elsewhere, but the style loop isn't.**

The prior-art survey found that the explainer pipeline already exists. HeyGen's HyperFrames has a `faceless-explainer` skill that goes from text to brief to design system to storyboard and script, then to audio, frames and MP4. It is Apache-2.0 and listed in Anthropic's official plugin marketplace. Remotion has official agent skills (`remotion-dev/skills`: 12 skills plus a Claude Code plugin), and the survey recommends reusing them rather than writing new guidance.

What none of these offer is a way to shape a style. HyperFrames picks from 13 fixed presets. Anthropic's `theme-factory` has 10 static colour-and-font themes. Google's DESIGN.md covers tokens and prose, HyperFrames' `frame.md` preset states that “Motion is out of scope,” and Remotion has no theme system at all. The survey's author infers that no existing format covers motion, camera, transitions, pacing, humour or voice.

The survey's conclusion is blunt: nobody ships the loop of describe, sample, comment, re-render and save a versioned style. “Build this. It is the product.”

| Exists today | Missing |
|---|---|
| ✓ **HyperFrames pipeline**: text → brief → storyboard → audio → MP4 | **Iterative style loop**: describe → sample → comment → re-render → save |
| ✓ **Remotion agent skills**: 12 skills + Claude Code plugin | |
| ✓ **13 fixed presets**: HyperFrames | |
| ✓ **10 static themes**: Anthropic theme-factory (colour + font) | |

| Format | Palette / type | Motion | Camera | Voice |
|---|---|---|---|---|
| Google DESIGN.md | ● | ○ | ○ | ○ |
| HyperFrames frame.md | ● | ○ (“out of scope”) | ○ | ○ |
| theme-factory | ● | ○ | ○ | ○ |
| Remotion | ○ (no theme system) | ○ | ○ | ○ |
| **Rocket Explainer style (v1 design)** | ● | ● | ● | ● |

> **Figure 3:** The pipeline exists. The loop that shapes a style does not. (Coverage gap is the survey author's inference.)

> **\*Aside:** Thirteen presets is a menu. A loop is a conversation.

## <a id="s4"></a>The Style Loop

**In short: describe it, watch a 10-second sample, say what's wrong, repeat, save.**

Defining a style takes six steps, and most of the time is spent going round steps 4 and 5.

1. **Name it**, now or later. At save time the agent suggests two or three names.
2. **Describe it**, or point at something it should look like. The seed style began as a single sentence: “Hitchhiker's Guide to the Galaxy animations, very smooth transitions, camera movement, highlights of what's appearing, neon blue/green, high contrast, lively, room for humor.”
3. **Pick a voice**: the TTS provider, the voice or character, and speed, inflection or liveliness where the provider supports it. Amazon Polly comes first.
4. **Render a sample** of about 10 seconds that exercises everything: an opening sequence, a transition, text pop-ups, boxes, a diagram and a camera move.
5. **Comment and re-render.** Watch and listen in the browser, write what's off (“voice is wrong”, “contrast too low”) and render again. The voice or model can be switched from a dropdown. Each round refines the style prompt.
6. **Save.** After that, the style can be cloned and edited.

Two helpers sit alongside the loop. One turns a reference video into style instructions an agent can use (“explain this video's style in terms an agent can use”). The other offers tips on writing good agentic style instructions.

| Step | Stage | What happens |
|---|---|---|
| 1 | Name | now or at save time |
| 2 | Describe | words or a reference |
| 3 | Voice | provider · character · speed |
| **4** | **~10 s sample** | exercises everything |
| **5** | **Comment + re-render** | watch, note (“voice is wrong”, “contrast too low”), render again |
| 6 | Save / clone | versioned asset |

> **Key point:** Steps 4 and 5 repeat until the sample looks and sounds right. Each round refines the style prompt.

- **The sample exercises:** opening · transition · text pop-ups · boxes · diagram · camera move

## <a id="s5"></a>Anatomy of a Style, and Where It Stands

**In short: a style is DESIGN.md plus motion, camera, voice and per-type rules, and all of it is still a design.**

A style file extends Google's DESIGN.md, which pairs YAML tokens (colours, typography, spacing) with prose. Rocket Explainer adds the sections no existing format covered: motion, camera, voice, and a rules section for each output type. The ~10 s video is the main sample. Deck, visual and doc samples render on demand the first time a style is used for that type.

The seed style is the Hitchhiker's Guide: neon green and blue on near-black, smooth camera moves, a dry narrator and room for humour, built only from the one-sentence description in the loop above.

Everything here is the v1 design recorded on 2026-10-01, not a list of shipped features. Two bakeoffs are still open: Remotion versus HyperFrames for the animation stack, and “chat gathers, web iterates” versus “web does everything” for the entry flow. Acceptance is dogfooding: explain this repo's own intent and research in the Hitchhiker's style, in all four output types.

| Style-file section | Example from the Hitchhiker's Guide style | Comes from |
|---|---|---|
| `colors` | background `#05080d`, primary `#39ff9c`, secondary `#2ec8ff`, highlight `#e8ff3a` | DESIGN.md base: tokens + prose |
| `typography` | display Inter 900 upper; mono JetBrains Mono 600 | DESIGN.md base: tokens + prose |
| `motion` | pace “lively”, enter “pop-overshoot” | Added by Rocket Explainer |
| `camera` | slow push-in, lateral pan, dive-through, pull-back reveal | Added by Rocket Explainer |
| `voice` | “dry, unhurried, mildly amused encyclopaedia narrator” | Added by Rocket Explainer |
| `## Video` `## Deck` `## Doc` `## Visual` | one section per output type | **Per-type rules** |

> **Figure 5:** A style file: DESIGN.md tokens and prose, plus the sections video needs.

> **Note:**
>
> | Status | Detail |
> |---|---|
> | Design recorded | 2026-10-01 (v1 design, not shipped behaviour) |
> | Still open | Animation stack: Remotion vs HyperFrames · Entry flow: chat-first vs web-only |
> | Acceptance | This repo's intent and research, Hitchhiker's style, all four output types |

> **\*Aside:** You are reading the seed style's doc rules in action. It seemed rude not to.
