import { createFakeTts } from '../../src/providers/fake/tts.ts';
import { createPollyTts } from '../../src/providers/polly/tts.ts';
import { createKokoroTts } from '../../src/providers/kokoro/tts.ts';
import { defaultHome, paths } from '../../src/datadir.ts';
import { ttsContract } from '../contracts/tts.ts';
import { liveSkip, LIVE_AWS_PROFILE } from '../contracts/live.ts';

ttsContract('fake', () => createFakeTts(), { voiceIds: ['fake-bright', 'fake-deep'] });

// One provider instance so the voice list is fetched once. Neural has native speech marks; generative is aligned.
let polly: ReturnType<typeof createPollyTts> | undefined;
ttsContract('polly', () => (polly ??= createPollyTts(() => ({ region: 'us-east-1', profile: LIVE_AWS_PROFILE }))), {
  voiceIds: ['Matthew:neural', 'Matthew:generative', 'Danielle:long-form'],
  skip: liveSkip,
});

// Kokoro runs locally: install it first (`node src/providers/kokoro/install.ts`, honours EXPLAINER_HOME).
// One instance so the warm worker is shared across tests. US and UK voices use different G2P pipelines.
let kokoro: ReturnType<typeof createKokoroTts> | undefined;
ttsContract('kokoro', () => (kokoro ??= createKokoroTts(paths(defaultHome()))), {
  voiceIds: ['af_heart', 'bm_george'],
  skip: liveSkip,
});
