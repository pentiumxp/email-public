import { ProxyAgent, setGlobalDispatcher, type Dispatcher } from "undici";

type Env = Record<string, string | undefined>;

interface ProxyCandidate {
  source: string;
  url: string;
}

interface ProxyDeps {
  createProxyAgent: (url: string) => Dispatcher;
  setGlobalDispatcher: (dispatcher: Dispatcher) => void;
}

export interface ProviderFetchProxyStatus {
  enabled: boolean;
  source?: string;
  proxy?: string;
  errorCode?: string;
}

const proxyVariables = [
  "EMAIL_PROVIDER_PROXY_URL",
  "EMAIL_PROVIDER_HTTPS_PROXY",
  "EMAIL_HTTPS_PROXY",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy"
];

let configuredProxyUrl: string | null = null;

export function configureProviderFetchProxyFromEnv(
  env: Env = process.env,
  deps: ProxyDeps = {
    createProxyAgent: (url) => new ProxyAgent(url),
    setGlobalDispatcher
  }
): ProviderFetchProxyStatus {
  const candidate = resolveProviderProxy(env);
  if (!candidate) {
    return { enabled: false };
  }
  if (!isHttpProxyUrl(candidate.url)) {
    return {
      enabled: false,
      source: candidate.source,
      proxy: redactProxyUrl(candidate.url),
      errorCode: "UNSUPPORTED_PROXY_PROTOCOL"
    };
  }
  if (configuredProxyUrl === candidate.url) {
    return { enabled: true, source: candidate.source, proxy: redactProxyUrl(candidate.url) };
  }
  deps.setGlobalDispatcher(deps.createProxyAgent(candidate.url));
  configuredProxyUrl = candidate.url;
  return { enabled: true, source: candidate.source, proxy: redactProxyUrl(candidate.url) };
}

export function resolveProviderProxy(env: Env = process.env): ProxyCandidate | null {
  for (const name of proxyVariables) {
    const value = env[name]?.trim();
    if (value) {
      return { source: name, url: value };
    }
  }
  return null;
}

export function redactProxyUrl(proxyUrl: string): string {
  try {
    const parsed = new URL(proxyUrl);
    if (parsed.username || parsed.password) {
      parsed.username = "***";
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return "invalid-proxy-url";
  }
}

function isHttpProxyUrl(proxyUrl: string): boolean {
  try {
    const parsed = new URL(proxyUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
