# Prior art: explainer skill

2026-10-01

Citations are `[n]` into Sources. "Verified" = read in a primary source today. "(inferred)" = my reading, not stated by the source.

## Bottom line

- **The pipeline already exists, as HeyGen's HyperFrames.** Its `faceless-explainer` skill goes text to brief to design system to storyboard and script to audio to frames to MP4. It is Apache-2.0, ships a Claude Code plugin, and is in Anthropic's official plugin marketplace [4][22][23]. It is the closest prior art, and the one competitor to Remotion as the first stack.
- **For Remotion, reuse the official skills and don't write your own Remotion guidance.** The `remotion-dev/skills` repo now ships 12 skills plus a Claude Code plugin [11][13]. The local copy is an older single-skill snapshot (see section 1).
- **Remotion licensing is a real constraint.** It is free for individuals and orgs of up to 3 people. Bigger orgs pay. Code that calls `npx remotion render` or embeds `<Player>` counts as an "automation" at $0.01 per render with a $100/month minimum [19][20]. The web app re-render loop fits that definition.
- **Nobody ships the style loop.** Describe, render a 10 s sample, comment, re-render, save a versioned style. No source found does this. HyperFrames picks from 13 fixed presets, and Anthropic's `theme-factory` has 10 static color/font themes [2][25]. **Build this. It is the product.**
- **Use DESIGN.md as the style file format.** It is Google's spec: YAML tokens plus prose, Apache-2.0 [39]. HyperFrames already extends it to `frame.md` for video [25]. Neither covers motion, camera, or voice, so we add those sections.
- **Polly works, with gaps.** Generative is the best-sounding engine but returns no speech marks and ignores pitch [30][33]. Neural gives word marks and the newscaster style. Plan a forced-alignment fallback.
- **Build the reference-video-to-style helper ourselves.** Claude takes up to 600 images per request but has no documented video input, so sampling frames with ffmpeg is the path [42][44].

## 1. Agent skills for explainers and visual explanations

Verified:
- **anthropics/skills** [1] has no video or explainer skill. The relevant ones:
  - `theme-factory`: 10 preset themes, each a markdown file with a palette and fonts, plus on-the-fly theme generation [2].
  - `canvas-design`: writes a "design philosophy" .md first, then renders it [3]. This two-step pattern maps well to the style prompt.
  - `pptx` (proprietary license), `frontend-design`, `brand-guidelines`, `algorithmic-art`, `slack-gif-creator` [1].
- **Official marketplace** (`claude-plugins-official`, 315 plugins):
  - `hyperframes`: HTML-to-video [4].
  - `playground`: interactive single-file HTML explorers [5].
  - `save-to-spotify`: TTS-narrated audio episodes [4].
  - No Remotion plugin is listed there. Remotion runs its own marketplace [13].
- **mattpocock/skills**: nothing for video or explainers. `productivity/teach` builds HTML reference sheets across sessions [6].
- **Community:**
  - `nicobailon/visual-explainer` (MIT, about 10k stars): HTML pages and slide decks for diagrams and plan reviews, with optional PPTX export [7]. This is the "show me" category: technical and static.
  - `iart-ai/explainer-video-skills` (MIT, 28 stars): script to storyboard to Remotion or GSAP render, with captions synced to the VO timing array. The README is a funnel to iart.ai [8].
  - `zhuyansen/awesome-claude-video-skills` indexes about 180 video-skill repos [9], and `VoltAgent/awesome-agent-skills` lists 1000+ skills [10]. These are secondary lists and I did not audit them.
- **Local `remotion-best-practices`:**
  - Installed 2026-03-27 from `remotion-dev/skills`.
  - One SKILL.md routing to 33 rule files: animations, timing/springs, sequencing, transitions, text-animations, charts, 3d, light-leaks, fonts, `calculate-metadata`, `voiceover` (ElevenLabs by default, with duration sized from the audio), `transcribe-captions`, `subtitles`, `extract-frames`, `parameters` (Zod), `ffmpeg`, and others.
  - It links `rules/sound-effects.md`, but the file on disk is `sfx.md`.
  - Upstream has since moved on: v4.0.532 is a router plus 12 skills (`remotion-create`, `-markup`, `-studio`, `-render`, `-captions`, ...). It adds a "preserve user changes" rule and multi-scene "connected compositions" [11][12].

Leverage: use the Remotion skills as-is and refresh the local copy. Borrow `canvas-design`'s philosophy-then-render pattern. Nothing here does styled narrated explainers with a feedback loop.

## 2. Agentic explainer-video pipelines

Verified:
- **Remotion's AI tooling:**
  - Agent Skills (`npx remotion skills add`) and plugins for Claude Code, Codex, Cursor, and Copilot [12][13][14].
  - A WebMCP surface in Studio: agents can read the selection, compositions, and errors, and can seek or play [16].
  - The hosted MCP is deprecated and shuts down no earlier than 2026-08-31 [15].
  - The "Prompt to Video" template does script, images, and voiceover via OpenAI and ElevenLabs [17].
- **Remotion license:**
  - Free for individuals, for-profit orgs with **up to 3 employees**, non-profits, and evaluation [18][19].
  - Above that, a Company License is required:
    - "Creators": **$25/month per seat**, for people who write Remotion code "themselves or using agentic coding tools".
    - "Automators": **$0.01 per render, $100/month minimum**, for orgs that own code calling `renderMedia()`, `npx remotion render`, `<Player>`, and similar.
    - Enterprise: from $500/month.
  - Studio and Player previews do not count as renders [19][20].
  - Remotion 5.0 will count contractors toward team size [21].
- **HyperFrames** (Apache-2.0, actively pushed) renders HTML, CSS, and GSAP to deterministic MP4 [22].
  - Skills: `faceless-explainer`, `motion-graphics`, `slideshow`, `embedded-captions`, and `remotion-to-hyperframes`.
  - Its explainer flow has user gates for brief, storyboard, and final render, and writes `STORYBOARD.md`, `SCRIPT.md`, and `frame.md` [23].
  - Voice comes from HeyGen TTS (sign-in) or local Kokoro [24].
- **Manim** (MIT): `manim-voiceover` adds per-word animation triggers via Whisper [26]. The `adithya-s-k/manim_skill` agent skill is MIT with about 1.1k stars [27].
- **Motion Canvas** (MIT) has no official agent skill that I found [28].

Inferred:
- If Rocket uses this for employer work at an org with 4+ people, the web app's `claude -p` re-render loop matches the Automators definition. Confirm with hi@remotion.dev.
- Manim fits math and diagrams but not "Hitchhiker's Guide" styles.

Leverage: Remotion skills and Studio for authoring. Study HyperFrames' gated flow and artifact files (BRIEF, STORYBOARD, SCRIPT, frame.md) as a reference design. Keep the animation-stack layer pluggable so HyperFrames can be stack #2.

## 3. TTS for narration

**Amazon Polly** (verified):

| | Standard | Neural | Long-form | Generative |
|---|---|---|---|---|
| prosody rate/volume | yes | yes | yes | yes, whole sentences only |
| prosody pitch | yes | no | no | no |
| `<emphasis>` | yes | no | no | no |
| `<mark>` | yes | yes | yes | partial |
| Newscaster (`amazon:domain name="news"`) | no | select voices | no | no |
| Speech marks (sentence/word/viseme/ssml) | yes | yes | yes | **not available** |

- Rate takes `x-slow` to `x-fast` or 20-200% [29][30][32][33].
- Newscaster works with Matthew and Joanna (en-US), Lupe (es-US), and Amy (en-GB) [31].
- Long-form runs only in us-east-1. Some of its voices also come in a "conversational" neural variant [34].
- I found no current conversational speaking-style SSML tag. **Unverified**; it may be retired.
- Inferred: generative quality means losing word marks. Recover them with forced alignment (Whisper or Parakeet, as manim-voiceover and HyperFrames do [24][26]), or with Remotion's `transcribe-captions` rule.

**Local:**
- **Kokoro**: 82M parameters, Apache-2.0 weights. The pipeline returns per-token `start_ts` and `end_ts` [36].
- **Piper**: the original repo is archived. Development moved to `OHF-Voice/piper1-gpl` (**GPL-3.0**, seeking maintainers). It offers `length_scale`, `noise_scale`, volume, sentence silence, and phoneme alignments [35]. Voice model licenses vary (unverified).

**API:**
- **ElevenLabs**: `/with-timestamps` returns character-level alignment. Settings are `stability`, `style`, and `speed` [37].
- **OpenAI**: `gpt-4o-mini-tts` takes free-text `instructions` (tone, accent, speed, emotion) and has 13 voices. No timestamps are documented. Policy requires disclosing that the voice is AI-generated [38].

Leverage: Polly neural for v1 (marks plus newscaster). Add generative behind an alignment step. Kokoro as the free local option. Normalize everything to one `{audio, words[{t0,t1,text}]}` contract.

## 4. Style as a reusable asset

Verified:
- **DESIGN.md** [39]: YAML tokens (colors, typography, spacing, rounded, components) with `{path}` references, plus prose sections. It ships a CLI that lints WCAG contrast, diffs versions, and exports to Tailwind or DTCG JSON.
- **HyperFrames `frame.md`** [25]: the same format, rescaled to the 1920x1080 frame. Its presets add a caption skin and a showcase page. The Cobalt Grid preset states "Motion is out of scope."
- **Theme files:**
  - Marp: CSS with a required `/* @theme name */` comment [40].
  - Remotion: no theme system. Props are typed with Zod and become editable controls in Studio [41].
  - `theme-factory`: palette plus fonts in markdown [2].
- **Reference video to style:**
  - Claude vision takes up to 600 images per request (100 on 200k-context models), and no video input is documented [42].
  - Gemini ingests video natively at 1 FPS by default (configurable) [43].
  - ffmpeg's `select` filter does scene-change detection [44].
  - The local Remotion skill has an `extract-frames` rule.

Inferred: no format covers motion, camera, transitions, pacing, humor, or voice. A style should be DESIGN.md tokens, plus our own `motion`, `voice`, and `sample` sections, plus a pinned sample render. Two ways to turn a reference video into a style: (a) sample frames at scene cuts plus ~1 FPS, send them to Claude, and get tokens and prose back; or (b) for motion, use Gemini on the raw clip. Option (b) is an optional, non-Claude provider.

Leverage: adopt DESIGN.md as the token core and its CLI for linting and diffs. Build the motion and voice extensions, versioning, clone, and the frame-sampling helper.

## Recommendation

**Reuse:**
- Remotion upstream skills and plugin. Refresh the stale local copy.
- Remotion Studio and Player for previews, which are not billed renders.
- DESIGN.md as the style token format.
- Polly neural with speech marks.
- Kokoro as the local fallback.
- HyperFrames' explainer flow and `frame.md` as a design reference.

**Build:**
- The style asset schema (tokens plus motion, voice, and sample) with versions and clones.
- The 10 s "exercise everything" sample composition.
- The comment-to-re-render web app running headless `claude -p`.
- The source-ingest report.
- The TTS adapter with word timings and an alignment fallback.
- The reference-video-to-style helper.
- Deck, one-pager, and doc renderers that consume the same style tokens.

**Risks:**
- Remotion Automator licensing for orgs of 4+ people. Decide before anyone uses this at work.
- HyperFrames already covers 60-70% of the video path under Apache-2.0 (inferred). Re-evaluate Remotion-first after the first sample bake-off.
- Polly generative has no speech marks and long-form is us-east-1 only.
- Upstream skills churn fast. The local copy already drifted within 6 months.
- Community video skills are mostly vendor funnels, so don't depend on them.

## Sources

1. https://github.com/anthropics/skills
2. https://github.com/anthropics/skills/tree/main/skills/theme-factory
3. https://github.com/anthropics/skills/blob/main/skills/canvas-design/SKILL.md
4. https://github.com/anthropics/claude-plugins-official/blob/main/.claude-plugin/marketplace.json
5. https://github.com/anthropics/claude-plugins-official/tree/main/plugins/playground
6. https://github.com/mattpocock/skills (skills/productivity/teach)
7. https://github.com/nicobailon/visual-explainer
8. https://github.com/iart-ai/explainer-video-skills
9. https://github.com/zhuyansen/awesome-claude-video-skills
10. https://github.com/VoltAgent/awesome-agent-skills
11. https://github.com/remotion-dev/skills
12. https://www.remotion.dev/docs/ai/skills
13. https://www.remotion.dev/docs/ai/claude-code-plugin
14. https://www.remotion.dev/docs/ai/coding-agents
15. https://www.remotion.dev/docs/ai/mcp
16. https://www.remotion.dev/docs/ai/webmcp
17. https://www.remotion.dev/templates/prompt-to-video
18. https://github.com/remotion-dev/remotion/blob/main/LICENSE.md
19. https://www.remotion.dev/docs/license/faq
20. https://www.remotion.pro/license
21. https://github.com/remotion-dev/remotion/pull/3750
22. https://github.com/heygen-com/hyperframes
23. https://github.com/heygen-com/hyperframes/blob/main/skills/faceless-explainer/SKILL.md
24. https://github.com/heygen-com/hyperframes/blob/main/skills/media-use/references/setup-providers.md
25. https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-creative/references/design-spec.md and .../frame-presets/cobalt-grid/FRAME.md
26. https://github.com/ManimCommunity/manim, https://github.com/ManimCommunity/manim-voiceover
27. https://github.com/adithya-s-k/manim_skill
28. https://github.com/motion-canvas/motion-canvas
29. https://docs.aws.amazon.com/polly/latest/dg/supportedtags.html
30. https://docs.aws.amazon.com/polly/latest/dg/prosody-tag.html
31. https://docs.aws.amazon.com/polly/latest/dg/newscaster-voices.html
32. https://docs.aws.amazon.com/polly/latest/dg/speechmarks.html, https://docs.aws.amazon.com/polly/latest/dg/using-speechmarks.html
33. https://docs.aws.amazon.com/polly/latest/dg/generative-voices.html
34. https://docs.aws.amazon.com/polly/latest/dg/long-form-voices.html
35. https://github.com/rhasspy/piper, https://github.com/OHF-Voice/piper1-gpl
36. https://github.com/hexgrad/kokoro (kokoro/pipeline.py `join_timestamps`)
37. https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
38. https://developers.openai.com/api/docs/guides/text-to-speech
39. https://github.com/google-labs-code/design.md/blob/main/docs/spec.md
40. https://marpit.marp.app/theme-css
41. https://www.remotion.dev/docs/schemas
42. https://platform.claude.com/docs/en/build-with-claude/vision
43. https://ai.google.dev/gemini-api/docs/video-understanding
44. https://ffmpeg.org/ffmpeg-filters.html#select_002c-aselect
