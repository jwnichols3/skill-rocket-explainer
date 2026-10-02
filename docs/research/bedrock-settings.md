# Bedrock settings for the `claude-bedrock` surface

2026-10-01

Citations are `[n]` into Sources. "Verified" = read in a primary source today. "(checked live)" = confirmed with a read-only `aws bedrock` call in a prototype account today. "(inferred)" = my reading, not stated by a source.

## Bottom line

- **"Global endpoint" is a model id choice, not a URL.** The runtime endpoint is always regional (`bedrock-runtime.{region}.amazonaws.com`) [9][13]. "Global" vs "regional" is picked by the inference profile prefix: `global.anthropic.…` vs a geo prefix like `us.` / `eu.` / `jp.` / `au.`, or a bare in-region model id [5][9].
- **Global is the right default.** It costs about 10% less than geo or in-region for Claude 4.5 and later [5][6][15], and it can be called from about 33 commercial source regions. Geo works from about 18 [9][10][11].
- **Global's cost: processing can happen in any commercial region.** Geo keeps it inside US/EU/JP/AU [5][7][9]. GovCloud has no global [9].
- **One missing knob: a routing scope.** Add `bedrock.scope = 'global' | 'geo' | 'in-region'`, default `'global'`. Pass it to Claude Code as `ANTHROPIC_BEDROCK_REGION_PREFIX` and use it to drive Discover / `suggestMapping` [1][2].
- **`geoPrefix()` is wrong for Claude 5.x in Asia Pacific.** The geos there are `jp.` and `au.`, not `apac.` [9] (checked live). Pick the prefix from what `ListInferenceProfiles` returns in the source region, not from the region name.
- **Polly stays independent.** It has its own profile and region and is untouched by Bedrock scope. The only shared thing is the `~/.aws` files.

## 1. What the app does today

As read 2026-10-01. Other agents are editing these files in parallel, so line numbers are left out.

Settings (`src/settings.ts`, `bedrock` block):

| Key | Type / default | Meaning |
| - | - | - |
| `bedrock.profile` | string, optional (empty = `default`) | AWS profile from `~/.aws/config` / `credentials` |
| `bedrock.region` | string, `us-east-1` | Region Bedrock is called in (the CRIS "source region") |
| `bedrock.models` | `Record<appModelId, string>`, `{}` | App model id to inference profile id or ARN. Empty = unmapped |

Polly is separate: `polly.region` (default `us-east-1`) and `polly.profile` (`src/providers/polly/tts.ts`). Empty profile = the full Node default chain, env keys included. Bedrock's empty profile means the `default` profile only.

Env that reaches `claude -p` (`bedrockSurfaceConfig` in `src/providers/claude/agent.ts`):

- Stripped first: `ANTHROPIC_*`, `CLAUDE_CODE_USE_*`, `CLAUDE_CODE_OAUTH_TOKEN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, `AWS_PROFILE`, `AWS_DEFAULT_PROFILE`, `AWS_REGION`, `AWS_DEFAULT_REGION`, plus every `CLAUDE*` except `CLAUDE_CONFIG_DIR` / `CLAUDE_CODE_OAUTH_TOKEN`.
- Set: `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_REGION=<bedrock.region>`, `AWS_PROFILE=<bedrock.profile>` (only if set).
- Kept: `AWS_CONFIG_FILE`, `AWS_SHARED_CREDENTIALS_FILE`.
- Flag: `--model <mapped id>`. `bedrockModel()` returns the mapping, passes through values that already look like Bedrock ids (`…anthropic.…`, ARNs), and otherwise fails the run as `unavailable`.
- Flag: `--restricted`. This loads only managed settings and `--settings` [4], so user-level `awsAuthRefresh`, `awsCredentialExport`, `modelOverrides` and `env` from `~/.claude/settings.json` do **not** apply. Anything the child needs must go through env or `--settings`.

Discovery (`src/providers/claude/bedrock.ts`, `src/routes/bedrock.ts`, `src/models.ts`):

- `listAwsProfiles` reads profile names, regions and SSO flags. It never reads keys.
- `listInferenceProfiles` calls `ListInferenceProfiles` for SYSTEM_DEFINED and APPLICATION types in the chosen region. Anthropic profiles sort first.
- `suggestMapping` matches each app model to profiles with the same `baseModel()` (date and version stripped). It prefers `${geoPrefix(region)}.`, then `global.`, then any match. `geoPrefix`: `us-gov-` -> `us-gov`, `us-` -> `us`, `eu-` -> `eu`, `ap-` -> `apac`, else `global`.
- `refreshCatalog` calls `ListFoundationModels(byProvider=Anthropic)` to add Bedrock models to the model dropdowns.
- UI (`agentSurfacesPanel` in `web/js/views/settings.js`): profile select, region select (21 regions plus Other), a mapping table, Discover, Save. There is no scope or routing control.

Gaps vs the sources below:

1. There is no way to say "global" or "geo" except by hand-picking ids. Discover prefers geo, the opposite of the owner's preference.
2. `ap-*` -> `apac` matches no Claude 5.x profile. Opus 5.5 offers `jp.` / `au.` [9]. Haiku 4.5 offers `jp.` / `au.` / `in.` [12]. In `ap-northeast-1` the listing returns only `jp.anthropic.claude-opus-5-5` and the `global.` profiles (checked live). It lands on `global.` by luck, not by design.
3. `BEDROCK_REGIONS` leaves out about 14 global source regions: `us-west-1`, `ca-west-1`, `us-gov-east-1`, `ap-east-2`, `ap-southeast-3..7`, `il-central-1`, `me-central-1`, `me-south-1`, `af-south-1`, `mx-central-1` [9]. "Other" covers them, but the list implies otherwise.
4. The current Claude 5.x foundation models are `INFERENCE_PROFILE`-only in `us-east-1`, so a bare `anthropic.claude-opus-5-5` cannot be invoked on demand there (checked live). In-region is rare (section 3).

## 2. Settings that affect Claude Code on Bedrock

All verified in [1][2][3] unless another citation is given. "App" = what Rocket Explainer should do with it.

| Setting | What it does | App |
| - | - | - |
| `CLAUDE_CODE_USE_BEDROCK=1` | Turns on Bedrock (Invoke API) [1][2] | Set (today) |
| `AWS_REGION` / `AWS_DEFAULT_REGION` | Source region. Precedence: `AWS_REGION`, `AWS_DEFAULT_REGION`, profile `region`, `us-east-1` [1] | Set `AWS_REGION` (today) |
| `AWS_PROFILE` | Profile for the default credential chain. SSO, role and process profiles work [1] | Set (today) |
| `AWS_CONFIG_FILE` / `AWS_SHARED_CREDENTIALS_FILE` | Non-default config paths [1] | Keep (today) |
| `ANTHROPIC_BEDROCK_REGION_PREFIX` | Preferred CRIS prefix: `us`, `eu`, `apac`, `jp`, `au`, `global`. Ignored in GovCloud (always `us-gov.`). v2.1.224+ [1][2] | **Add**, from `bedrock.scope` |
| `--model` / `ANTHROPIC_MODEL` | Session model. Accepts inference profile ids, ARNs, or Anthropic ids. Anthropic ids resolve to the provider id the `/model` picker would use. Background tasks then use this model too [1][3] | Set via `--model` (today) |
| `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` | Pin what aliases resolve to [2][3] | Not needed: the app always passes a concrete `--model` |
| `ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION` | Region for the Haiku-class background model. Only acts with `ANTHROPIC_DEFAULT_HAIKU_MODEL` set [1][2] | Not needed |
| `ANTHROPIC_SMALL_FAST_MODEL` | Deprecated [2] | Do not use |
| `modelOverrides` (settings) | Anthropic id to provider id/ARN per version [1][3] | Only via `--settings` (because of `--restricted`). The app's own map does this job already |
| Application inference profile ARN | Your own profile, for cost tags or fixed routing. Pass as the model id [1][8] | Supported today (Discover lists APPLICATION profiles) |
| `AWS_BEARER_TOKEN_BEDROCK` | Bedrock API key. Bypasses the credential chain [1][16] | Stripped today. Optional later (see section 4) |
| `AWS_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` / `_SESSION_TOKEN` | Static keys via the chain [1] | Stripped today. Keep it that way: profile only |
| `awsAuthRefresh` / `awsCredentialExport` (settings) | Run a command to refresh or export creds [1] | Not available under `--restricted`. The app's preflight plus "run `aws sso login`" covers it |
| `CLAUDE_CODE_SKIP_AWS_CRED_CACHE`, `CLAUDE_CODE_AWS_CHAIN_RESOLVE_TIMEOUT_MS` | Cred cache off; chain timeout (default 60 s) [1][2] | Not needed |
| `ANTHROPIC_BEDROCK_BASE_URL` | Custom endpoint or gateway URL [1][2] | Not exposed (advanced: VPC endpoint or gateway) |
| `CLAUDE_CODE_SKIP_BEDROCK_AUTH` | Skip SigV4, for a gateway that signs [2] | Not exposed |
| `ANTHROPIC_BEDROCK_SERVICE_TIER` | `default` / `flex` / `priority`, sent as `X-Amzn-Bedrock-Service-Tier` [1][2] | Not exposed: Opus 5.5, Sonnet 5.5 and Fable 5.1 list Standard only [9][10][11] |
| `ANTHROPIC_CUSTOM_HEADERS` (Guardrails) | `X-Amzn-Bedrock-GuardrailIdentifier` / `GuardrailVersion`. The guardrail needs cross-region turned on when used with CRIS [1] | Not exposed |
| `DISABLE_PROMPT_CACHING` (and `_OPUS` / `_SONNET` / `_HAIKU` / `_FABLE`), `ENABLE_PROMPT_CACHING_1H` | Caching off; 1 h TTL (billed higher) [1][2] | Leave default (on, 5 min) |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, `MAX_THINKING_TOKENS` | Output cap; fixed thinking budget. On third-party providers `MAX_THINKING_TOKENS=0` omits `thinking`, and adaptive models may still think [2][3] | Not needed: the app uses `--effort` |
| `CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK`, `CLAUDE_CODE_SKIP_MODEL_ACCESS_MEMORY` | Stop the mid-session model switch; turn off the refusal memory [1][2] | Not needed: a concrete `--model` id is a pin, so no tier switch happens [1] |
| `CLAUDE_CODE_USE_MANTLE` (+ `ANTHROPIC_BEDROCK_MANTLE_BASE_URL`, `CLAUDE_CODE_SKIP_MANTLE_AUTH`) | Bedrock Mantle endpoint (Anthropic Messages shape). In-region only, **no CRIS** [1][13] | Not exposed: it conflicts with "default global" |

Notes:

- The Claude Code docs put no Bedrock credentials or region in user settings for this app. With `--restricted`, env is the only channel apart from `--settings` [4].
- IAM for Claude Code: `bedrock:InvokeModel`, `InvokeModelWithResponseStream`, `ListInferenceProfiles`, `GetInferenceProfile` on `inference-profile/*`, `application-inference-profile/*`, `foundation-model/*`. Add `aws-marketplace:ViewSubscriptions` / `Subscribe` for first use [1].
- `ListInferenceProfiles` matters: with it, Claude Code resolves the preferred prefix against real profiles. Without it, Claude Code applies the prefix blindly, and a missing profile returns a 400 [1].
- Installed CLI here is 2.1.287, so `ANTHROPIC_BEDROCK_REGION_PREFIX` (2.1.224+) is available.

## 3. In-region vs geo vs global

| | In-region | Geo cross-region | Global cross-region |
| - | - | - | - |
| Model id | `anthropic.claude-opus-5-5` (bare) | `us.` / `eu.` / `jp.` / `au.` (Haiku 4.5 also `in.`), `us-gov.` in GovCloud [1][9][12] | `global.anthropic.claude-opus-5-5` [9] |
| Where it runs | The source region only | Regions inside the geography. US geo = US + Canada [9] | Any supported commercial region. The list can grow over time [6][8] |
| Data residency | Strictest | Stays in the geography. Prompts and outputs can leave the source region and may be stored in the destination region for abuse detection [7][8] | No residency boundary [5][9] |
| Price | Regional: +10% over global [14][15] | Standard (regional) price [5]. Anthropic calls this +10% over global [14][15] | About 10% cheaper than geo. Price is set by the source region [5][6] |
| Quotas | Per-region model quotas | "Cross-region model inference … per minute" quotas [7] | Separate "Global cross-Region model inference … per minute" quotas, managed in the source region [6] |
| IAM / SCP | Model in region | Profile + model in every destination region. Region-deny SCPs must allow them or exempt via `bedrock:InferenceProfileArn` [7] | Profile + regional model + region-less `arn:aws:bedrock:::foundation-model/…`. SCPs must allow `aws:RequestedRegion = "unspecified"` [6] |
| Logging | Source region | CloudTrail in the source region. `additionalEventData.inferenceRegion` shows where it ran [5] | Same; CloudWatch and CloudTrail stay in the source region [5][6] |
| Opt-in regions | n/a | Can route to opt-in regions you never turned on [5][8] | Same [5][8] |

How the source region relates to the call: the source region is wherever the API call goes (`AWS_REGION`). The profile then routes the request to one of its destination regions. The destinations can depend on the source [8]. Live check: `us.anthropic.claude-opus-5-5` called from `us-east-1` lists models in `us-east-1`, `us-east-2` and `us-west-2`. `global.anthropic.claude-opus-5-5` lists the `us-east-1` model plus the region-less global model ARN (checked live). `GetInferenceProfile` shows each profile's destinations [8].

Other caveats:

- Prompt caching works with CRIS, but routing at peak load "may lead to increased cache writes" [17].
- No CRIS on Mantle [13], and none with Provisioned Throughput [5].
- Global inference is not offered in GovCloud for any of the four models checked [9][10][11][12]. Claude Code forces `us-gov.` there [1].

### Which models support global, and from where

From the AWS model cards (`bedrock-runtime`) [9][10][11][12]:

| Model | Global id | Geo ids | In-region | Global source regions | Geo source regions |
| - | - | - | - | - | - |
| Opus 5.5 | `global.anthropic.claude-opus-5-5` | us, eu, au, jp | `eu-west-2` only | All 33 commercial regions listed | US/CA 6, GovCloud 2, EU 8, `ap-northeast-1/3`, `ap-southeast-2/4` |
| Sonnet 5.5 | `global.anthropic.claude-sonnet-5-5` | us, eu | none | 33 commercial | US/CA 6, GovCloud 2, EU 8 |
| Fable 5.1 | `global.anthropic.claude-fable-5-1` | us | none | 33 commercial | US/CA 6, GovCloud 2 |
| Haiku 4.5 | `global.anthropic.claude-haiku-4-5-20251001-v1:0` | us, eu, au, jp, in | none | 33 commercial | 19 (US/CA 5, EU 8, AP 6) |

The 33 commercial global source regions: `us-east-1`, `us-east-2`, `us-west-1`, `us-west-2`, `ca-central-1`, `ca-west-1`, `eu-central-1`, `eu-central-2`, `eu-north-1`, `eu-south-1`, `eu-south-2`, `eu-west-1`, `eu-west-2`, `eu-west-3`, `ap-east-2`, `ap-northeast-1`, `ap-northeast-2`, `ap-northeast-3`, `ap-south-1`, `ap-south-2`, `ap-southeast-1` through `ap-southeast-7`, `il-central-1`, `me-central-1`, `me-south-1`, `af-south-1`, `sa-east-1`, `mx-central-1` [9].

Anthropic's docs list the global endpoint for Fable 5.1, Fable 5, Opus 5.5, Opus 5, Opus 4.8, Opus 4.7, Sonnet 5.5, Sonnet 5 and Haiku 4.5 [14].

Source conflicts, flagged:

- The AWS "Supported Regions and models" page still says global is "only supported on Anthropic Claude Sonnet 4". The same page says per-model cards are now authoritative [8]. Treat that sentence as stale.
- Anthropic's region table (all models merged) marks different regions "In-region only" than the Opus 5.5 card does [9][14]. It also omits a few regions, such as `ap-east-2` and `mx-central-1`. Trust the per-model AWS card and the live `ListInferenceProfiles`.

## 4. Recommendation

### Settings to make selectable

| Setting (proposed key) | UI | Default | Child env / effect |
| - | - | - | - |
| AWS profile (`bedrock.profile`, exists) | select | `''` = `default` | `AWS_PROFILE` |
| Source region (`bedrock.region`, exists) | select + Other. List the 33 global source regions + GovCloud 2 | `us-east-1` | `AWS_REGION` |
| **Routing scope (`bedrock.scope`, new)** | radio: Global (recommended) / Geographic / In-region | `'global'` | `ANTHROPIC_BEDROCK_REGION_PREFIX`: see the mapping below |
| Model mapping (`bedrock.models`, exists) | table, filled by Discover, each row shows a scope badge | `{}` | `--model <id>` |

Scope to env:

- `global` -> `ANTHROPIC_BEDROCK_REGION_PREFIX=global`.
- `geo` -> the prefix for the region, if it is one Claude Code accepts: `us-*` / `ca-*` -> `us`, `eu-*` -> `eu`, `ap-northeast-1/3` -> `jp`, `ap-southeast-2/4` -> `au`. Otherwise leave it unset. In GovCloud leave it unset, since Claude Code forces `us-gov.` [1].
- `in-region` -> leave it unset. In-region needs an explicit bare-id mapping.
- In every scope, the explicit `--model` id is what actually routes. Claude Code never rewrites an id you pass [1]. The prefix only governs anything Claude Code resolves itself.

Leave out of the UI for now, with the reason: API keys, base URL / skip-auth, service tier, guardrail headers, caching toggles, output and thinking token caps, Mantle. Each is either unused by current Claude 5.x models, conflicts with global, or is handled by `--effort` / `--model` (section 2).

Behaviour rules:

- GovCloud region selected: disable Global and force Geo (`us-gov.`) [1][9].
- Global chosen: show one line: "Processed in any AWS commercial region; about 10% cheaper; needs SCPs to allow `aws:RequestedRegion=unspecified`" [5][6].
- Migration: existing saved mappings keep working as explicit ids. A missing `scope` merges to `'global'` through `DEFAULT_SETTINGS`. Mapped rows whose prefix disagrees with the scope show a warning badge, and Discover offers to re-suggest them. Assumption: the owner wants old `us.` mappings flagged, not silently rewritten.

### Discovery and `suggestMapping`

- Signature: `suggestMapping(modelIds, profiles, region, scope)`.
- Drop `geoPrefix()`. Classify each SYSTEM_DEFINED Anthropic profile by its own id instead: `global.` = global; any other `xx.` prefix = geo. `ListInferenceProfiles` in a source region returns only profiles callable from there, so "non-global system profile for this model" is exactly the region's geo option. This handles `jp.` / `au.` / `in.` / `us-gov.` without a table (checked live in `us-east-1` and `ap-northeast-1`).
- Preference order per app model:
  - `global`: `global.` -> geo -> in-region. Falling back to a stricter scope is safe, but it costs about 10% more. Show the fallback in the status line.
  - `geo`: geo -> in-region. **Never** fall back to `global.`: that would break the residency the user chose.
  - `in-region`: the bare foundation id, only if `ListFoundationModels` reports `ON_DEMAND` in `inferenceTypesSupported` for it. Otherwise leave it unmapped with a clear message. The current Claude 5.x models in `us-east-1` are `INFERENCE_PROFILE`-only (checked live).
- APPLICATION profiles (ARNs): never auto-suggested (as today). When picked, show the badge "custom". The Claude Code docs note ARNs skip the startup model checks and fallback [1].
- Return `{ id, scope, fellBack }` per model so the UI can badge rows and explain fallbacks.
- `sdkFoundationModels`: also return `inferenceTypesSupported`, so in-region scope can filter.
- Optional, not required: when an app model is unmapped and scope is global or geo, pass the Anthropic id (`claude-opus-5-5`) through instead of failing. Claude Code resolves it with the prefix and profile discovery (v2.1.224+, needs `ListInferenceProfiles`) [1][3]. Tradeoff: less friction, but the routed id is no longer visible in Settings. I'd keep the current explicit-map-or-fail behaviour and rely on Discover.

### Doctor and preflight

- Add a check that the default model's mapped profile prefix matches `scope`.
- If a global call fails with AccessDenied, add a hint to the fix: "Global needs the three-part IAM policy and SCP `aws:RequestedRegion=unspecified`; or switch scope to Geographic" [6].
- Update `docs/agent-surfaces.md` and the live contract default from `us.anthropic.claude-haiku-4-5-20251001-v1:0` to `global.…`, to match the new default.

### Polly interaction

- None functionally. Bedrock scope and region do not affect Polly, and Polly keeps `polly.profile` / `polly.region`.
- Do not reuse `bedrock.region` for Polly. Long-form voices exist only in `us-east-1` (enforced in `src/providers/polly/tts.ts`), while Bedrock may sit in any source region.
- Credential semantics differ: Polly's empty profile = full default chain, env keys included; Bedrock's empty profile = `default`, with inherited AWS env ignored. Keep them separate. A "same profile as Bedrock" shortcut would be UI sugar only (inferred).
- Global CRIS changes nothing for Polly. Polly has no inference profiles, and its data stays in `polly.region` (inferred: no CRIS concept appears in Polly docs reviewed for prior-art.md).

## Sources

1. https://code.claude.com/docs/en/amazon-bedrock
2. https://code.claude.com/docs/en/env-vars
3. https://code.claude.com/docs/en/model-config
4. https://code.claude.com/docs/en/cli-reference (`--restricted`)
5. https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html
6. https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html
7. https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html
8. https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html
9. https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.html
10. https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html
11. https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-fable-5-1.html
12. https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html
13. https://docs.aws.amazon.com/bedrock/latest/userguide/endpoints.html
14. https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock (Regions)
15. https://platform.claude.com/docs/en/about-claude/pricing (Regional and multi-region endpoint pricing)
16. https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html
17. https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
