// Server entry point used by `explainer start` (runs detached).
import { startServer } from './server.ts';
import { defaultHome } from './datadir.ts';

const portArg = process.argv.indexOf('--port');
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : undefined;
const server = await startServer({ home: defaultHome(), port });
console.log(`rocket-explainer listening on ${server.url}`);
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => { server.close().finally(() => process.exit(0)); });
}
