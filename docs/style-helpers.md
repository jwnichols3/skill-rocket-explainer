# Style helpers

Three helpers for defining a style: a reference video turned into style instructions, reference
images and links that inform the sample, and suggestions that make a description more agent-usable.
Code: `src/pipeline/style-helpers.ts`, prompts in `src/prompts/style.ts`, UI in
`web/js/components/references.js`.

## References

A style keeps its references in `style.json` (`references`) and their files in
`<style dir>/references/`. They are served from `/media/styles/<id>/references/...` and copied
with the style on clone.

| Kind  | Stored                                   | Reaches the sample task as |
|-------|------------------------------------------|----------------------------|
| image | the file (png, jpg, webp, gif; max 20 MB) | `references/<file>` in the agent workdir; the agent Reads it |
| link  | URL and an optional note                  | listed (`url`, `note`); the agent can't open it |
| video | the file (mp4, mov, webm, mkv, m4v; max 500 MB), sampled frames, derived instructions | listed with its instructions (already applied to description and DESIGN.md) |

`POST /api/styles/:id/references` takes either:

- **Raw bytes** with `content-type: image/*` or `video/*` and `?name=<file name>`. This is what the
  UI uses: the browser may be on another machine behind a reverse proxy, so it can't hand the app
  a local path. The server streams the body to disk with a per-kind limit (413 above it) and checks
  the bytes (image magic numbers, ffprobe for a video stream; 415 otherwise). Requests whose
  content type is `image/*`, `video/*` or `application/octet-stream` skip the 5 MB JSON body parser.
- **JSON** `{ "url": "https://...", "note": "..." }` for a link, or `{ "path": "~/clip.mp4" }` for a
  file on the app's machine (copied in, same checks). Handy for scripts and the CLI.

`DELETE /api/styles/:id/references/:rid` removes one, with its file and frames.

## Reference video to style instructions

`POST /api/styles/:id/references/:rid/analyze` starts a `style-reference-video` job on the style
(one job per style, like samples). Stages: Sampling frames, Reading the frames, Saving instructions.

Frame sampling (`sampleFrames`):

```
ffmpeg -t 600 -i <video> -an -sn \
  -vf "select='isnan(prev_selected_t)+gte(t-prev_selected_t,1)*(gt(scene,0.3)+gte(t-prev_selected_t,<every>))',showinfo,scale='min(768,iw)':-2" \
  -fps_mode vfr -q:v 4 frames/f%03d.jpg
```

A frame at every scene change (score above 0.3), plus one every `<every>` seconds (clip length / 24,
at least 1) so long shots and dissolves are covered, never two within 1 s, first 10 minutes only.
Timestamps come from `showinfo`. More than 24 frames: an evenly spaced 24 are kept. JPEGs are at
most 768 px wide (about 450 vision tokens each at 16:9).

The task: frames go into the agent's workdir (`frames/`), so a `--restricted` Claude session can
Read them; tools are `Read` and `Write` only.

- inputs.json: `description`, `currentDesign`, `video { name, durationMs }`, `frames [{ file, atMs }]`
- result.json: `instructions` (6-12 `- ` lines of concrete instructions), `design` (a complete DESIGN.md)

The instructions are appended to the style's description under `From the reference video "<name>":`.
A valid `design` replaces the style's DESIGN.md draft (an invalid one is logged and skipped). Both
show on the style page before the first sample, with the sampled frames; then "Render first sample".
The first sample starts from that draft. Frames are kept in `references/<rid>-frames/`.

## Suggestions

`POST /api/styles/suggest` `{ description, model? }` is a synchronous `style-suggestions` agent call at
low effort. It returns `{ suggestions: [{ topic, text }] }`, 3 to 6 of them, topics from palette,
typography, motion, camera, voice, humour, layout, avoid. Each `text` is a sentence the user can
insert into the description as-is (one click in the new-style form).

## Tests

- `test/api/style-helpers.test.ts`, `test/e2e/style-helpers.spec.ts`: fake agent, generated media
  (`test/helpers/media.ts`: ffmpeg `testsrc`/`smptebars`/`color` with hard cuts).
- `test/api/style-helpers-live.test.ts`: real Claude Code on the subscription (`LIVE=1`).
