import type { LocalDatabaseConnection } from './local-database.js';
import { resolveSharedDeepSeek, sharedDeepSeekNativeBaseUrl, type SharedDeepSeekEnvironment, type SharedDeepSeekFallback } from './oar-model-configuration.js';

type SharedModel = ReturnType<typeof resolveSharedDeepSeek>['configuration'];
type SharedRoute = Pick<SharedModel, 'provider' | 'baseUrl'>;

function endpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('Hindsight LLM endpoint is not a valid URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Hindsight LLM endpoint must be an HTTP(S) URL without credentials, query or fragment.');
  }
  return url.href.replace(/\/+$/, '');
}

/** Check a resolved non-secret route before the Host reads its credential. */
export function needsHindsightSharedConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  sharedRoute?: SharedRoute,
): boolean {
  const fields = ['LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_BASE_URL'];
  for (const [name, value] of Object.entries(environment)) {
    if (name.startsWith('HIMA_HINDSIGHT_') && /(?:^|_)LLM_(?:PROVIDER|MODEL|API_KEY|BASE_URL)$/.test(name)
      && value !== undefined && !value.trim()) {
      throw new Error('Hindsight explicit LLM configuration contains an empty required field.');
    }
  }
  const provider = environment.HIMA_HINDSIGHT_LLM_PROVIDER;
  const base = environment.HIMA_HINDSIGHT_LLM_BASE_URL;
  if (base !== undefined) endpoint(base);
  if (fields.slice(0, 3).every(field => environment['HIMA_HINDSIGHT_' + field] !== undefined)) return false;
  if (provider === undefined && base === undefined) return true;
  if (!sharedRoute) return false;
  const sharedProvider = sharedRoute.provider === 'anthropic-messages' ? 'anthropic' : 'openai';
  const sharedBase = sharedDeepSeekNativeBaseUrl('pi', sharedRoute.baseUrl, sharedRoute.provider);
  return (provider === undefined || provider === sharedProvider)
    && (base === undefined || endpoint(base) === endpoint(sharedBase));
}

/** Host adapter wiring; only this module decides whether to read shared secrets. */
export async function resolveHindsightServiceEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  modelEnvironment: SharedDeepSeekEnvironment,
  readSharedModel: (readCredential: boolean) => Promise<SharedDeepSeekFallback>,
): Promise<Record<string, string>> {
  // Validate before invoking either Host port. Complete explicit tuples are independent.
  const defaultRoute = environment.HIMA_HINDSIGHT_LLM_PROVIDER === undefined
    && environment.HIMA_HINDSIGHT_LLM_BASE_URL === undefined;
  const needsDefault = needsHindsightSharedConfiguration(environment);
  const complete = ['LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY']
    .every(field => environment['HIMA_HINDSIGHT_' + field] !== undefined);
  if (complete) return resolveHindsightEnvironment(environment);
  let metadata: SharedDeepSeekFallback | undefined;
  if (!defaultRoute) {
    const host = metadata = await readSharedModel(false);
    // The existing resolver owns endpoint/protocol priority. Route-only resolution
    // uses private sentinels for its required non-route fields, never credentials.
    const route = resolveSharedDeepSeek({ ...modelEnvironment, DEEPSEEK_API_KEY: 'route-only', DEEPSEEK_MODEL: 'route-only' }, host).configuration;
    if (!needsHindsightSharedConfiguration(environment, route)) return resolveHindsightEnvironment(environment);
  } else if (!needsDefault) return resolveHindsightEnvironment(environment);
  // Apply service-specific key/model priority only after its route is established.
  const effectiveEnvironment: SharedDeepSeekEnvironment = {
    ...modelEnvironment,
    DEEPSEEK_API_KEY: environment.HIMA_HINDSIGHT_LLM_API_KEY ?? modelEnvironment.DEEPSEEK_API_KEY,
    DEEPSEEK_MODEL: environment.HIMA_HINDSIGHT_LLM_MODEL ?? modelEnvironment.DEEPSEEK_MODEL,
  };
  const host = metadata && effectiveEnvironment.DEEPSEEK_API_KEY !== undefined
    ? metadata : await readSharedModel(effectiveEnvironment.DEEPSEEK_API_KEY === undefined);
  return resolveHindsightEnvironment(environment, resolveSharedDeepSeek(effectiveEnvironment, host).configuration);
}

/** Private service environment only. Does not read credentials, process state or network. */
export function resolveHindsightEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  shared?: SharedModel,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (name.startsWith('HIMA_HINDSIGHT_') && value !== undefined) {
      result[name.replace(/^HIMA_HINDSIGHT_/, 'HINDSIGHT_API_')] = value;
    }
  }
  const prefix = 'HINDSIGHT_API_';
  const fields = ['LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_BASE_URL'] as const;
  // Explicit emptiness must never activate SDK defaults or a shared credential.
  for (const [name, value] of Object.entries(result)) {
    if (/(?:^|_)LLM_(?:PROVIDER|MODEL|API_KEY|BASE_URL)$/.test(name) && !value.trim()) {
      throw new Error('Hindsight explicit LLM configuration contains an empty required field.');
    }
  }
  const explicitProvider = result[prefix + 'LLM_PROVIDER'];
  const explicitBase = result[prefix + 'LLM_BASE_URL'];
  if (explicitBase !== undefined) endpoint(explicitBase);
  const sharedProvider = shared?.provider === 'anthropic-messages' ? 'anthropic' : 'openai';
  const sharedBase = shared && sharedDeepSeekNativeBaseUrl('pi', shared.baseUrl, shared.provider);
  const compatible = shared !== undefined
    && (explicitProvider === undefined || explicitProvider === sharedProvider)
    && (explicitBase === undefined || endpoint(explicitBase) === endpoint(sharedBase!));
  if (compatible) {
    const fallback = [sharedProvider, shared.model, shared.apiKey, sharedBase!];
    fields.forEach((field, index) => { result[prefix + field] ??= fallback[index]!; });
  }
  for (const field of fields.slice(0, 3)) {
    if (!result[prefix + field]?.trim()) {
      throw new Error('Hindsight LLM configuration requires its own provider, model and API key or a compatible shared DeepSeek configuration.');
    }
  }
  const primaryBase = result[prefix + 'LLM_BASE_URL'];
  if (primaryBase !== undefined) endpoint(primaryBase);
  // Operation-specific routes inherit primary values in Hindsight. Require a full
  // private tuple before allowing such a route to change provider or endpoint.
  for (const operation of ['RETAIN', 'REFLECT', 'CONSOLIDATION', 'MENTAL_MODEL_REFRESH']) {
    const operationPrefix = prefix + operation + '_';
    const provider = result[operationPrefix + 'LLM_PROVIDER'];
    const base = result[operationPrefix + 'LLM_BASE_URL'];
    if (base !== undefined) endpoint(base);
    if ((provider !== undefined && provider !== result[prefix + 'LLM_PROVIDER'])
      || (base !== undefined && (primaryBase === undefined
        || endpoint(base) !== endpoint(primaryBase)))) {
      if (fields.slice(0, 3).some(field => !result[operationPrefix + field]?.trim())
        || (provider !== undefined && provider !== result[prefix + 'LLM_PROVIDER']
          && primaryBase !== undefined && base === undefined)) {
        throw new Error('Hindsight operation LLM route requires its own provider, model, API key and endpoint when overriding an inherited endpoint.');
      }
    }
  }
  return result;
}

/** The admin reader needs only the existing private DB, never worker/model/provider setup. */
export async function resolveHindsightMaintenanceConfiguration(readDatabase:()=>Promise<LocalDatabaseConnection>):Promise<{databaseUrl:string}> {
  const connection=await readDatabase();
  if(connection.host!=='127.0.0.1'||connection.database!=='hima_hindsight'||connection.user!=='hima_hindsight'
    ||!Number.isSafeInteger(connection.port)||connection.port<1024||connection.port>65535||!connection.password)
    throw new Error('Maintenance requires the original private Hindsight database connection.');
  const database=new URL(`postgresql://127.0.0.1:${connection.port}/hima_hindsight`);
  database.username=connection.user;database.password=connection.password;
  return {databaseUrl:database.href};
}
