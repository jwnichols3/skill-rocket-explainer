# Agent surfaces

An agent surface is where the agent that writes reports, plans, scripts and scenes runs. Pick the
default in Settings > Agent surfaces (`providers.agent`); each explainer can override it under
Choices > Runs on (`surface` on `PUT /api/explainers/:id`), so sensitive sources can stay on a
narrower surface. Every surface passes the shared contract in `test/contracts/agent.ts`.

## Claude Code, subscription (`claude-subscription`)

Headless `claude -p` on the logged-in claude.ai account. Any inherited `ANTHROPIC_*`, `AWS_*` and
`CLAUDE_CODE_USE_*` variables are dropped so the run cannot drift onto the API or Bedrock.

## Claude Code on Amazon Bedrock (`claude-bedrock`)

The same headless `claude -p`, billed to an AWS account instead of the subscription.

Settings (`bedrock`):

- `profile`: the AWS profile from `~/.aws/config` (empty = `default`). SSO, role and key profiles work.
- `region`: where Bedrock is called.
- `models`: app model id -> Bedrock inference profile id or ARN, e.g.
  `{ "claude-opus-5-5": "us.anthropic.claude-opus-5-5" }`. A model id that already is a Bedrock id
  (`us.anthropic.…`, `global.anthropic.…`, an ARN) is used as is. Any other unmapped model fails
  the run with an `unavailable` error that says where to map it.

The child gets `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_PROFILE` and `AWS_REGION`, and `--model <inference profile>`.
Inherited `ANTHROPIC_*`, `CLAUDE_CODE_USE_*`, `CLAUDE_CODE_OAUTH_TOKEN`, AWS keys, `AWS_PROFILE` and
region variables are dropped first; `AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE` are kept.

Before starting the CLI the surface resolves the profile's credentials; expired SSO or a missing
profile fails at once as `auth`, with the fix (`aws sso login --profile <profile>`).

### Discovery

- `GET /api/bedrock/profiles`: profile names, regions and whether they use SSO, read from
  `~/.aws/config` and `~/.aws/credentials` (honouring `AWS_CONFIG_FILE` and
  `AWS_SHARED_CREDENTIALS_FILE`). Keys are never read out.
- `GET /api/bedrock/inference-profiles?profile=&region=`: the inference profiles the profile can
  use there (`ListInferenceProfiles`, system-defined and application), Anthropic Claude first, plus
  `suggested`: a mapping for the app's model list (same model ignoring date/version suffixes,
  preferring the region's geography prefix, then `global.`). The Discover button fills empty
  mappings from it.

Doctor, when Bedrock is the default surface: Claude Code CLI present, the profile's credentials
resolve, the default model is mapped.

### Live contract

```bash
LIVE=1 EXPLAINER_LIVE_AWS_PROFILE=<profile> node --test --test-name-pattern=claude-bedrock test/api/contract-agent.test.ts
```

It maps `claude-haiku-4-5` to `us.anthropic.claude-haiku-4-5-20251001-v1:0` at low effort
(override with `EXPLAINER_LIVE_BEDROCK_MODEL`, region with `EXPLAINER_LIVE_AWS_REGION`).

## Models and effort

Settings > Models edits the model list (id + label, ordered), the default model and the default
effort. The default model must stay in the list; the server refuses a list without it.
