import { createFakeVideoRenderer } from '../../src/providers/fake/renderer.ts';
import { rendererContract } from '../contracts/renderer.ts';

rendererContract('fake', () => createFakeVideoRenderer(), { outputType: 'video', expectExt: ['.mp4'] });
