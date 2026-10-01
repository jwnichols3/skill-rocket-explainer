/** Live (real-provider) tests are opt-in: LIVE=1. They need credentials and cost money/time. */
export const LIVE = process.env.LIVE === '1';
export const liveSkip = LIVE ? false : 'live test: set LIVE=1 to run';

/** AWS profile for live AWS tests. Never hard-code one in the repo. */
export const LIVE_AWS_PROFILE = process.env.EXPLAINER_LIVE_AWS_PROFILE;

/** ElevenLabs key for live tests, from the environment only. Never commit one. */
export const LIVE_ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
/** A voice every account has; override with ELEVENLABS_LIVE_VOICE. */
export const LIVE_ELEVENLABS_VOICE = process.env.ELEVENLABS_LIVE_VOICE || 'JBFqnCBsd6RMkjVDRZzv';
