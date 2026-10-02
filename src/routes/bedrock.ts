import type { App } from '../app.ts';
import type { Router } from '../router.ts';
import { HttpError } from '../router.ts';
import { listAwsProfiles, listInferenceProfiles, suggestMapping, isCredentialsError, discovery, type InferenceProfile } from '../providers/claude/bedrock.ts';
import { bedrockAuthFix } from '../providers/claude/agent.ts';
import { readCatalog, refreshCatalog } from '../models.ts';
import { AWS_REGION as REGION, AWS_PROFILE as PROFILE, BEDROCK_SCOPES, type BedrockScope } from '../settings.ts';
import { pollyChecks } from '../providers/polly/tts.ts';


/** AWS discovery for Settings: Bedrock (Models & agents) and Polly (Voices). */
export function bedrockRoutes(app: App, router: Router) {
  // Profile names and regions from ~/.aws/config and ~/.aws/credentials; never keys.
  router.get('/api/bedrock/profiles', async () => ({ profiles: await listAwsProfiles(), selected: app.settings().bedrock.profile ?? '' }));

  // Models for Settings' dropdowns: built-in list, plus Bedrock's once refreshed (cached).
  router.get('/api/models/available', () => readCatalog(app.paths.home));
  // A POST: it calls AWS and rewrites the cache, so it sits behind the mutation guard.
  router.post('/api/models/available/refresh', () => refreshCatalog(app.paths.home, app.settings()));

  // Tries a Polly profile and region (saved or not) with one cheap DescribeVoices call.
  router.get('/api/tts/polly/check', async ({ url }) => {
    const s = app.settings();
    const profile = url.searchParams.get('profile') ?? s.polly.profile ?? '';
    const region = url.searchParams.get('region') || s.polly.region;
    if (profile && !PROFILE.test(profile)) throw new HttpError(400, `not an AWS profile name: "${profile}"`);
    if (!REGION.test(region)) throw new HttpError(400, `not an AWS region: "${region}"`);
    const { ok, detail, fix } = await pollyChecks[0].run({ ...s, polly: { region, ...(profile ? { profile } : {}) } }, app.paths);
    return { ok, detail, ...(fix ? { fix } : {}) };
  });

  router.get('/api/bedrock/inference-profiles', async ({ url }) => {
    const s = app.settings();
    const profile = url.searchParams.get('profile') ?? s.bedrock.profile ?? '';
    const region = url.searchParams.get('region') || s.bedrock.region;
    const scope = (url.searchParams.get('scope') || s.bedrock.scope) as BedrockScope;
    if (profile && !PROFILE.test(profile)) throw new HttpError(400, `not an AWS profile name: "${profile}"`);
    if (!REGION.test(region)) throw new HttpError(400, `not an AWS region: "${region}"`);
    if (!BEDROCK_SCOPES.includes(scope)) throw new HttpError(400, `not a routing scope: "${scope}" (use global, geo or in-region)`);
    const problems: { source: 'foundation-models' | 'inference-profiles'; message: string }[] = [];
    let inferenceProfiles: InferenceProfile[];
    try {
      inferenceProfiles = await listInferenceProfiles({ profile, region });
    } catch (err: any) {
      if (isCredentialsError(err)) throw new HttpError(401, `AWS credentials for profile ${profile || 'default'} are not usable (${err?.message ?? err}). Fix: ${bedrockAuthFix({ profile })}`);
      // In-region uses only foundation models, so it carries on without profiles.
      if (scope !== 'in-region') throw new HttpError(502, `Bedrock (${region}): ${err?.message ?? err}`);
      problems.push({ source: 'inference-profiles', message: `Bedrock inference profiles (${region}): ${err?.message ?? err}` });
      inferenceProfiles = [];
    }
    const ids = s.models.map((m) => m.id);
    let suggested = suggestMapping(ids, inferenceProfiles, region, scope);
    // Only in-region needs foundation models: asked for when a model is still unmapped. Not fatal: in-region then maps nothing.
    if (ids.some((id) => !suggested[id])) {
      const foundationModels = await discovery.foundationModels({ profile, region }).catch((err: any) => {
        problems.push({ source: 'foundation-models', message: `Bedrock foundation models (${region}): ${err?.message ?? err}` });
        return [];
      });
      suggested = suggestMapping(ids, inferenceProfiles, region, scope, foundationModels);
    }
    return { profile, region, scope, inferenceProfiles, suggested, problems };
  });
}
