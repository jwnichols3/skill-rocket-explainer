import { createFakeAgent } from '../../src/providers/fake/agent.ts';
import '../../src/providers/fake/responders.ts';
import { agentContract } from '../contracts/agent.ts';
import { liveSkip } from '../contracts/live.ts';
import { createClaudeSurface, SUBSCRIPTION } from '../../src/providers/claude/agent.ts';

agentContract('fake', () => createFakeAgent(() => ({})), { model: 'claude-opus-5-5', effort: 'high', failingRun: { kind: 'no-such-task' } });

// Real Claude Code on the logged-in subscription. Opt-in: LIVE=1. A cheap model at low effort.
agentContract('claude-subscription', () => createClaudeSurface(SUBSCRIPTION), {
  model: 'claude-haiku-4-5-20251001', effort: 'low', failingRun: { model: 'claude-no-such-model' }, skip: liveSkip,
});
