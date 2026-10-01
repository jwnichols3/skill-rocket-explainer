import { createFakeTts } from '../../src/providers/fake/tts.ts';
import { createPollyTts } from '../../src/providers/polly/tts.ts';
import { createElevenLabsTts } from '../../src/providers/elevenlabs/tts.ts';
import { ttsContract } from '../contracts/tts.ts';
import { liveSkip, LIVE_AWS_PROFILE, LIVE_ELEVENLABS_KEY, LIVE_ELEVENLABS_VOICE } from '../contracts/live.ts';

ttsContract('fake', () => createFakeTts(), { voiceIds: ['fake-bright', 'fake-deep'] });

// One provider instance so the voice list is fetched once. Neural has native speech marks; generative is aligned.
let polly: ReturnType<typeof createPollyTts> | undefined;
ttsContract('polly', () => (polly ??= createPollyTts(() => ({ region: 'us-east-1', profile: LIVE_AWS_PROFILE }))), {
  voiceIds: ['Matthew:neural', 'Matthew:generative', 'Danielle:long-form'],
  skip: liveSkip,
});

// Live ElevenLabs: LIVE=1 plus ELEVENLABS_API_KEY in the environment. The mock-HTTP run is in elevenlabs.test.ts.
let elevenlabs: ReturnType<typeof createElevenLabsTts> | undefined;
ttsContract('elevenlabs', () => (elevenlabs ??= createElevenLabsTts({ apiKey: async () => LIVE_ELEVENLABS_KEY })), {
  voiceIds: [LIVE_ELEVENLABS_VOICE],
  skip: liveSkip || (LIVE_ELEVENLABS_KEY ? false : 'live test: set ELEVENLABS_API_KEY to run'),
  timeout: 120_000,
});
