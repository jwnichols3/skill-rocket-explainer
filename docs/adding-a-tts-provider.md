# Adding a TTS provider that needs an API key

ElevenLabs (`src/providers/elevenlabs/tts.ts`) is the template. Copy it, rename, and change the
HTTP calls. Everything else (secrets storage, the Settings field, doctor, voice picker, preview)
works from the registry entry.

## 1. Files to copy

| Copy | To | What changes |
|---|---|---|
| `src/providers/elevenlabs/tts.ts` | `src/providers/<id>/tts.ts` | endpoints, auth header, voice mapping, capabilities, timings |
| `test/helpers/elevenlabs-mock.ts` | `test/helpers/<id>-mock.ts` | the endpoints your provider calls, shaped like the real responses |
| `test/api/elevenlabs.test.ts` | `test/api/<id>.test.ts` | the same cases against your mock |

Then add one registry entry, one live contract registration and, if the provider has a
non-obvious setup, a line in this guide.

## 2. The interface

`TtsProvider` in `src/providers/types.ts`:

- `voices()`: id, name and language are required (the contract checks them); gender, engine and
  description are optional and shown in the voice picker. Cache the list per instance; the registry
  drops instances when settings or secrets change.
- `capabilities(voiceId)`: see section 3.
- `synthesize(text, voiceId, controls, outFile)`: write audio to `outFile` (WAV unless the caller
  asked for `.mp3`) and return `{ audioFile, durationMs, words }`. Measure `durationMs` from the
  written file (`probeDurationMs`), and convert to WAV with the `ffmpeg` helper in `src/media.ts`.

### Word timings

Pick the best source the API offers:

- Character alignment (ElevenLabs `/with-timestamps`): `wordsFromAlignment()` groups non-space runs
  into words, start of first character to end of last. Reuse it if your API returns the same shape.
- Word onsets (Polly speech marks): `wordsFromOnsets()` in `src/align.ts`.
- Nothing: `alignWords()` in `src/align.ts` (silence-aware proportional alignment), and report
  `wordTimings: 'aligned'`.

Whatever the source, clamp to the audio length and keep starts monotonic; the contract fails otherwise.

## 3. Capabilities and unsupported reasons

The UI has three numeric controls (`rate`, `pitch`, `volume`) and named `styles`. For each one,
either expose a `ControlRange` or put a one-sentence reason in `unsupported`, which the voice
picker shows next to the disabled control. The contract fails if a control is neither.

Map the provider's native units onto the shared ones (ElevenLabs `speed` 0.7-1.2 becomes rate
70-120%), clamp before sending, and send nothing for a control left at its default. Provider-only
knobs with no shared equivalent (ElevenLabs stability, style exaggeration) stay at the voice's
defaults until we add a control for them; say so in a comment.

## 4. Secrets

- Store keys only through `src/secrets.ts` (`getSecret`, `setSecret`, `secretStatus`). They live in
  `<home>/secrets.json`, mode 0600, re-chmodded on every write, never in settings.json.
- Declare the secret names on the registry entry (`secrets: ['apiKey']`). That alone gives you
  `PUT /api/secrets/<id> { apiKey }` (empty string deletes) and a write-only field on Settings >
  Voice providers. `GET /api/secrets` and the Settings page only ever see `'set'`.
- Resolve the key at call time (`apiKey: () => getSecret(env.paths, '<id>', 'apiKey')`), so a key
  saved in Settings works without a restart.
- Never put the key in an error message, log line or response. Errors from the API go through one
  `request()` helper that scrubs the key and maps 401/403 to "API key rejected ... Fix: add your
  <Provider> API key in Settings > Voice providers". A missing key fails before any request.
- Let tests point the provider elsewhere: take `fetch` and `baseUrl` options, and default the base
  URL from an env var (`ELEVENLABS_API_BASE`) so the app-level tests can use the mock.

## 5. Doctor checks

Export a `<id>Checks()` returning `CheckDef[]` and attach it to the registry entry; doctor runs it
only when the provider is selected. The ElevenLabs check reports a missing key (fix: where to add
it), then makes one cheap authenticated call (`GET /v1/voices`) and reports a rejected key without
echoing it.

## 6. Registry entry

In `src/providers/registry.ts`:

```ts
<id>: {
  label: '<Provider>',
  create: (env) => create<Provider>Tts({ apiKey: () => getSecret(env.paths, '<id>', 'apiKey') }),
  checks: <id>Checks(),
  secrets: ['apiKey'],
},
```

The provider then appears in `GET /api/settings` (`available.tts`), the default-provider select,
and every voice picker.

## 7. Tests

- Mock HTTP (always runs): run `ttsContract('<id> (mock HTTP)', ...)` against your mock, plus unit
  tests for voice mapping, capabilities, control mapping, timing conversion, missing and rejected
  keys, the doctor check, and an app-level test that the key never shows up in API responses,
  settings.json or `logs/app.log`.
- Live (opt-in): register in `test/api/contract-tts.test.ts` with
  `skip: liveSkip || (KEY ? false : 'live test: set <ID>_API_KEY to run')`, reading the key from the
  environment in `test/contracts/live.ts`. Run with `LIVE=1 <ID>_API_KEY=... npm run test:live`.
  Never commit a key.
