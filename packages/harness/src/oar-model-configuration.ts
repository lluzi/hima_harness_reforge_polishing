// Configuration only: no runtime launch, discovery request or credential writes.
export type MemberModelApi = 'anthropic-messages' | 'openai-completions';
export interface SharedDeepSeekFallback {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  provider?: MemberModelApi;
  sources?: Partial<Record<'apiKey' | 'baseUrl' | 'model' | 'provider', string>>;
}
export interface SharedDeepSeekEnvironment {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_API?: string;
}
export function resolveSharedDeepSeek(environment: SharedDeepSeekEnvironment, host: SharedDeepSeekFallback) {
  const apiKey = environment.DEEPSEEK_API_KEY ?? host.apiKey;
  const baseUrl = environment.DEEPSEEK_BASE_URL ?? host.baseUrl;
  const model = environment.DEEPSEEK_MODEL ?? host.model;
  if (!apiKey?.trim()) throw new Error('Shared DeepSeek API key is missing from environment and Host credentials.');
  if (!baseUrl?.trim()) throw new Error('Shared DeepSeek endpoint is missing from environment and Host configuration.');
  if (!model?.trim()) throw new Error('Shared DeepSeek model is missing from environment and Host selection.');
  let url: URL;
  try { url = new URL(baseUrl); }
  catch { throw new Error('Shared DeepSeek endpoint is not a valid URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Shared DeepSeek endpoint must be an HTTP(S) URL without credentials, query or fragment.');
  }
  let provider: MemberModelApi | undefined;
  let providerSource: string | undefined;
  if (environment.DEEPSEEK_API !== undefined) {
    if (!['anthropic-messages', 'openai-completions'].includes(environment.DEEPSEEK_API)) {
      throw new Error('DEEPSEEK_API must be anthropic-messages or openai-completions.');
    }
    provider = environment.DEEPSEEK_API as MemberModelApi;
    providerSource = 'environment:DEEPSEEK_API';
  } else if (environment.DEEPSEEK_BASE_URL !== undefined && url.hostname === 'api.deepseek.com') {
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '/anthropic' || path === '/anthropic/v1') provider = 'anthropic-messages';
    else if (path === '' || path === '/v1') provider = 'openai-completions';
    providerSource = 'endpoint:documented-deepseek-route';
  } else if (environment.DEEPSEEK_BASE_URL === undefined || baseUrl === host.baseUrl) {
    provider = host.provider;
    providerSource = host.sources?.provider ?? 'host:protocol';
  }
  if (!provider) throw new Error('Shared DeepSeek endpoint protocol is unknown; retain the Host endpoint or specify DEEPSEEK_API.');
  const sources = {
    apiKey: environment.DEEPSEEK_API_KEY !== undefined ? 'environment:DEEPSEEK_API_KEY' : host.sources?.apiKey ?? 'host:credentials',
    baseUrl: environment.DEEPSEEK_BASE_URL !== undefined ? 'environment:DEEPSEEK_BASE_URL' : host.sources?.baseUrl ?? 'host:endpoint',
    model: environment.DEEPSEEK_MODEL !== undefined ? 'environment:DEEPSEEK_MODEL' : host.sources?.model ?? 'host:selection',
    provider: providerSource!,
  };
  return { configuration: { apiKey, baseUrl, model, provider }, sources };
}

// DSH's Messages root appends /v1 once. The pinned Pi Anthropic SDK appends
// /v1/messages; OpenCode's AI SDK appends /messages. Translate that same route.
export function sharedDeepSeekNativeBaseUrl(runtime: 'pi' | 'opencode', baseUrl: string, provider: MemberModelApi): string {
  if (provider !== 'anthropic-messages') return baseUrl;
  const root = baseUrl.replace(/\/+$/, '');
  const hasVersion = new URL(root).pathname.endsWith('/v1');
  return runtime === 'pi' ? hasVersion ? root.slice(0, -3) : root : hasVersion ? root : root + '/v1';
}

type ConfigurationContext = { get(name: never): unknown };
type LaunchEnvironment = { get(name: string): { value: string; source: string } | undefined };
export function readSharedDeepSeekEnvironment(ctx: ConfigurationContext): SharedDeepSeekEnvironment {
  const launch = ctx.get('launchEnvironment' as never) as LaunchEnvironment | undefined;
  return Object.fromEntries(['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL', 'DEEPSEEK_API']
    .map(name => [name, process.env[name] ?? launch?.get(name)?.value]).filter(([, value]) => value !== undefined));
}
export async function readHostDeepSeekConfiguration(ctx: ConfigurationContext, readCredential = true): Promise<SharedDeepSeekFallback> {
  const selection = (ctx.get('agentDefaultModel' as never) as { currentSelection(): { provider: string; model: string } | undefined } | undefined)?.currentSelection();
  const directory = (ctx.get('llm' as never) as { listConfigurableProviders(): { provider: string; settingsNs: string; settingsPath: readonly string[] }[] } | undefined)?.listConfigurableProviders() ?? [];
  const route = directory.find(row => row.provider === selection?.provider && row.provider.startsWith('deepseek-'))
    ?? directory.find(row => row.provider === 'deepseek-official');
  const settings = (ctx.get('settings' as never) as { describe(options: { redactSecrets: boolean }): { ns: string; value: unknown }[] } | undefined)?.describe({ redactSecrets: true });
  let value = settings?.find(row => row.ns === route?.settingsNs)?.value;
  for (const part of route?.settingsPath ?? []) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
  const config = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const ref = typeof config.apiKeyEnv === 'string' ? config.apiKeyEnv : 'DEEPSEEK_API_KEY';
  if (readCredential && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) throw new Error('Host DeepSeek credential reference is invalid.');
  const credentials = ctx.get('credentials' as never) as { resolve(ref: string): Promise<{ value: string; source: string } | undefined> } | undefined;
  const launch = ctx.get('launchEnvironment' as never) as LaunchEnvironment | undefined;
  const hostEnvironment = (name: string) => {
    if (launch) return launch.get(name);
    const value = process.env[name];
    return value === undefined ? undefined : { value, source: 'process' };
  };
  const credential = !readCredential ? undefined : credentials ? await credentials.resolve(ref) : hostEnvironment(ref);
  const launchEndpoint = hostEnvironment('DEEPSEEK_BASE_URL');
  return {
    apiKey: credential?.value,
    baseUrl: typeof config.baseURL === 'string' ? config.baseURL : launchEndpoint?.value ?? 'https://api.deepseek.com/anthropic',
    model: selection?.provider.startsWith('deepseek-') ? selection.model : undefined,
    provider: 'anthropic-messages', // Pinned DSH rc.2 DeepSeek adapters are Messages-only.
    sources: { apiKey: credential ? (credentials ? 'host:credentials:' : 'host:launch-environment:') + credential.source : 'host:credentials-missing',
      baseUrl: typeof config.baseURL === 'string' ? 'host:provider-settings' : launchEndpoint ? 'host:launch-environment:' + launchEndpoint.source : 'host:deepseek-adapter-default',
      model: 'host:agentDefaultModel', provider: 'host:deepseek-messages-adapter' },
  };
}
