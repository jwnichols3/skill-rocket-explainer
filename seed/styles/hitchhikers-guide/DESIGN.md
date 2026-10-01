---
colors:
  background: "#05080d"
  surface: "#0b1622"
  panel: "#0f2233"
  primary: "#39ff9c"
  secondary: "#2ec8ff"
  highlight: "#e8ff3a"
  alert: "#ff5c8a"
  text: "#eafff5"
  muted: "#7f9bb0"
  grid: "#123a4d"
typography:
  display: { family: "Inter", weight: 900, letterSpacing: "-0.02em", case: "upper" }
  body: { family: "Inter", weight: 500 }
  mono: { family: "JetBrains Mono", weight: 600, letterSpacing: "0.04em" }
  scale: { hero: 132, title: 76, popup: 46, body: 34, label: 22, footnote: 20 }
spacing: { unit: 8, safeArea: 96, gutter: 32 }
rounded: { sm: 10, md: 18, lg: 32, pill: 999 }
stroke: { width: 3, highlight: 6 }
glow: { blur: 22, opacity: 0.55 }
motion:
  pace: "lively"
  easing: "cubic-bezier(0.34, 1.56, 0.64, 1)"
  easingCamera: "cubic-bezier(0.65, 0, 0.35, 1)"
  transitionMs: 550
  enter: "pop-overshoot"
  enterMs: 320
  stagger: 90
camera:
  moves: ["slow push-in", "lateral pan", "dive-through", "pull-back reveal"]
  maxZoom: 1.35
  minMoveMs: 1200
voice:
  delivery: "dry, unhurried, mildly amused encyclopaedia narrator"
---
# Hitchhiker's Guide

> Hitchhiker's Guide animations, very smooth transitions, camera movement, highlights of what's appearing,
> neon blue/green, high contrast, lively, room for humor.

## Identity and tone

An electronic field guide explaining the universe to a reader who is slightly out of their depth. Flat,
geometric vector illustration on a near-black background. Neon green (`primary`) is the subject; neon blue
(`secondary`) is structure and connections; acid yellow (`highlight`) marks the thing to look at right now.
Contrast is always high: light strokes and type on dark, never mid-grey on dark.

Humour is dry and specific. It is one aside per scene at most, delivered as a small footnote-style
pop-up (mono, `footnote` size, `muted` colour, prefixed with an asterisk) or a deadpan line of narration. The
joke never replaces the explanation: the facts land first, then the aside. Never mock the viewer.

Shapes: rounded rectangles (`rounded.md`), circles, and thin connector lines with small arrowheads. Icons
are simple pictograms built from these primitives, never clip art or photos. A faint blueprint grid
(`grid`, 48 px, 12% opacity) sits behind everything and moves with the camera at 50% speed for parallax.

## Motion

Smooth above all. Nothing cuts and nothing teleports; everything eases.
- Elements enter with `pop-overshoot`: scale 0.6 to 1.0 with the `easing` curve over `enterMs`, fading in
  over the first 40%. Groups stagger by `stagger` ms, left to right or in reading order.
- When narration names something, highlight it: an acid-yellow underline or ring draws on over 250 ms,
  holds while it is spoken, then fades over 400 ms. Time it to the word timings.
- Lines and arrows draw on from source to target (stroke-dashoffset), 400-700 ms.
- Exits are quicker than entrances (60%) and move away from the camera's direction of travel.
- Ambient life: one or two elements idle-float (2-4 px, 3 s period) so a frame is never dead still.
- Never use spins, bounces after landing, glitch effects or strobe.

## Camera

The camera is a character: it travels through one continuous 2D world rather than cutting between slides.
- Every scene has at least one move, and moves last at least `minMoveMs` with `easingCamera`.
- Push-in to focus on the thing being explained (up to `maxZoom`); pull back to reveal context.
- Lateral pans connect ideas side by side ("meanwhile, over here...").
- `dive-through` is the signature transition: the camera pushes into a small element (a box, a node, a
  letter) until it fills the frame, and the next scene's world is revealed inside it.
- Hold still for at least 600 ms after a move before text the viewer must read appears.

## Voice

A dry, unhurried, mildly amused narrator: think encyclopaedia entry read by someone who has seen it all.
Medium pace (about 2.4 words per second), clear consonants, short sentences, a small pause before the
punchline. Warm but never excited; the visuals carry the energy, the voice stays calm. No rhetorical "So,"
openers and no "Let's dive in".

## Video

- 1920x1080 at 30 fps. Safe area 96 px. Scenes run 4-15 s, set by the narration.
- Opening: the title assembles from shapes in the dark (letters pop in with stagger), a highlight sweeps
  under it, then the camera dives through the first letter into scene one.
- Text pop-ups: at most 7 words, `popup` size, on a `panel` card with `rounded.md` and a 1 px `secondary`
  border, entering with `pop-overshoot`. Never more than two text pop-ups on screen.
- Boxes: rounded rectangles with a `secondary` stroke and a mono label; the active box fills with `primary`
  at 15% and glows.
- Diagrams: nodes and connectors drawn on in the order narration mentions them; labels in mono.
- Captions are not burned in.
- Every scene ends with a moment of stillness (300-500 ms) before the transition.

## Deck

- 16:9 slides, same palette and grid background, one idea per slide.
- Title top-left in display caps at `title` size; one supporting line in body.
- Diagrams and boxes as in Video, static, with the highlight colour marking the takeaway.
- At most 3 bullets, 8 words each. Footnote-style aside allowed bottom-left, mono, muted.
- Speaker notes carry the narration.

## Doc

- Letter or A4, generous margins (1 inch), light background variant: background `#f6fbf9`, text `#0b1622`,
  headings in `#0f2233` with a 4 px `primary` rule under H1 and H2, and links in `secondary` darkened to
  `#0b7fb0`.
- Body 11 pt Inter, line-height 1.5; headings in display caps, tracked.
- Callouts: a left border in `highlight` darkened to `#9aa800`, with a "Note" or "*Aside" label in mono.
- Figures are the same flat diagrams, rendered on the light background.

## Visual

- One dense, poster-like page on the dark background, 1600 px wide.
- A big display-caps headline, then 3-6 panels in a grid with clear reading order. Each panel is a card
  with a mono label, a diagram or number, and one sentence.
- One highlight-coloured "look here" element per page. One footnote-style aside, bottom-right.
