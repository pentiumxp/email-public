import { describe, expect, it } from "vitest";
import type { Dispatcher } from "undici";
import { configureProviderFetchProxyFromEnv, redactProxyUrl, resolveProviderProxy } from "../connectors/http/provider-fetch-proxy";

const fakeDispatcher = { dispatch: () => false } as unknown as Dispatcher;

describe("provider fetch proxy", () => {
  it("prefers Email-specific proxy variables before generic shell variables", () => {
    expect(resolveProviderProxy({
      HTTPS_PROXY: "http://generic.local:7890",
      EMAIL_PROVIDER_HTTPS_PROXY: "http://email.local:7890"
    })).toEqual({ source: "EMAIL_PROVIDER_HTTPS_PROXY", url: "http://email.local:7890" });
  });

  it("installs an undici dispatcher for supported HTTP proxy URLs", () => {
    const calls: string[] = [];
    const status = configureProviderFetchProxyFromEnv(
      { HTTPS_PROXY: "http://127.0.0.1:7890" },
      {
        createProxyAgent: (url) => {
          calls.push(url);
          return fakeDispatcher;
        },
        setGlobalDispatcher: () => undefined
      }
    );

    expect(status).toEqual({ enabled: true, source: "HTTPS_PROXY", proxy: "http://127.0.0.1:7890/" });
    expect(calls).toEqual(["http://127.0.0.1:7890"]);
  });

  it("does not install unsupported socks proxy URLs", () => {
    const calls: string[] = [];
    const status = configureProviderFetchProxyFromEnv(
      { ALL_PROXY: "socks5h://127.0.0.1:7890" },
      {
        createProxyAgent: (url) => {
          calls.push(url);
          return fakeDispatcher;
        },
        setGlobalDispatcher: () => undefined
      }
    );

    expect(status).toEqual({
      enabled: false,
      source: "ALL_PROXY",
      proxy: "socks5h://127.0.0.1:7890",
      errorCode: "UNSUPPORTED_PROXY_PROTOCOL"
    });
    expect(calls).toEqual([]);
  });

  it("redacts proxy credentials in status labels", () => {
    expect(redactProxyUrl("http://user:secret@127.0.0.1:7890")).toBe("http://***:***@127.0.0.1:7890/");
  });
});
