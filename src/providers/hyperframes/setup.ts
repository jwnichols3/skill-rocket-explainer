#!/usr/bin/env node
// Installs the HyperFrames toolchain (CLI, GSAP, agent skills) into the data dir cache now,
// instead of on the first render. Respects EXPLAINER_HOME.
import { defaultHome } from '../../datadir.ts';
import { ensureToolchain } from './toolchain.ts';
import { hyperframesCacheRoot } from './checks.ts';

const tc = await ensureToolchain(hyperframesCacheRoot(defaultHome()), (l) => console.log(l));
console.log(`installed: ${tc.dir}`);
