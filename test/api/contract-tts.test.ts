import { createFakeTts } from '../../src/providers/fake/tts.ts';
import { createPollyTts } from '../../src/providers/polly/tts.ts';
import { ttsContract } from '../contracts/tts.ts';
import { liveSkip, LIVE_AWS_PROFILE } from '../contracts/live.ts';

ttsContract('fake', () => createFakeTts(), { voiceIds: ['fake-bright', 'fake-deep'] });

// One provider instance so the voice list is fetched once. Neural has native speech marks; generative is aligned.
let polly: ReturnType<typeof createPollyTts> | undefined;
ttsContract('polly', () => (polly ??= createPollyTts(() => ({ region: 'us-east-1', profile: LIVE_AWS_PROFILE }))), {
  voiceIds: ['Matthew:neural', 'Matthew:generative', 'Danielle:long-form'],
  skip: liveSkip,
});
