import { createFakeAgent } from '../../src/providers/fake/agent.ts';
import '../../src/providers/fake/responders.ts';
import { agentContract } from '../contracts/agent.ts';
import { liveSkip, LIVE_AWS_PROFILE } from '../contracts/live.ts';
import { createClaudeSurface, SUBSCRIPTION, bedrockSurfaceConfig } from '../../src/providers/claude/agent.ts';

agentContract('fake', () => createFakeAgent(() => ({})), { model: 'claude-opus-5-5', effort: 'high', failingRun: { kind: 'no-such-task' } });

// Real Claude Code on the logged-in subscription. Opt-in: LIVE=1. A cheap model at low effort.
agentContract('claude-subscription', () => createClaudeSurface(SUBSCRIPTION), {
  model: 'claude-haiku-4-5-20251001', effort: 'low', failingRun: { model: 'claude-no-such-model' }, skip: liveSkip,
});

// Claude Code on Amazon Bedrock. Opt-in: LIVE=1 and EXPLAINER_LIVE_AWS_PROFILE (region: EXPLAINER_LIVE_AWS_REGION,
// default us-east-1). The app model id maps to a cheap inference profile; an unmapped model is the typed failure.
agentContract('claude-bedrock', () => createClaudeSurface(bedrockSurfaceConfig(() => ({
  profile: LIVE_AWS_PROFILE, region: process.env.EXPLAINER_LIVE_AWS_REGION || 'us-east-1',
  models: { 'claude-haiku-4-5': process.env.EXPLAINER_LIVE_BEDROCK_MODEL || 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
}))), {
  model: 'claude-haiku-4-5', effort: 'low', failingRun: { model: 'claude-no-such-model' },
  skip: liveSkip || (LIVE_AWS_PROFILE ? false : 'live test: set EXPLAINER_LIVE_AWS_PROFILE to run'),
});
