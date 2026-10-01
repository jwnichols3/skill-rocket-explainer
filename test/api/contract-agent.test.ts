import { createFakeAgent } from '../../src/providers/fake/agent.ts';
import '../../src/providers/fake/responders.ts';
import { agentContract } from '../contracts/agent.ts';

agentContract('fake', () => createFakeAgent(() => ({})), { model: 'claude-opus-5-5', effort: 'high', failingRun: { kind: 'no-such-task' } });
