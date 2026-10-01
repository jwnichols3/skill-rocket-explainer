import { createFakeTts } from '../../src/providers/fake/tts.ts';
import { ttsContract } from '../contracts/tts.ts';

ttsContract('fake', () => createFakeTts(), { voiceIds: ['fake-bright', 'fake-deep'] });
