// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../web/src/ui/App";

describe("mail account quick switcher", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows mailbox accounts on the first-level message page and switches without opening folders", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url === "/api/accounts") {
        return jsonResponse({
          accounts: [
            account("gmail-primary", "Gmail", "user@gmail.example"),
            account("outlook-hotmail-primary", "Hotmail", "user@hotmail.example")
          ]
        });
      }
      if (url.includes("/api/folders?accountId=gmail-primary")) {
        return jsonResponse({ folders: [folder("gmail-inbox", "gmail-primary", "INBOX")] });
      }
      if (url.includes("/api/folders?accountId=outlook-hotmail-primary")) {
        return jsonResponse({ folders: [folder("outlook-inbox", "outlook-hotmail-primary", "Inbox")] });
      }
      if (url.includes("/api/messages")) {
        expect(url).toContain("limit=50");
        return jsonResponse({ messages: [] });
      }
      return jsonResponse({}, 404);
    }));

    const rootElement = document.getElementById("root");
    if (!rootElement) {
      throw new Error("missing root");
    }
    await act(async () => {
      createRoot(rootElement).render(<App />);
    });

    await waitFor(() => expect(document.querySelector(".quick-account-switcher")).not.toBeNull());
    expect(document.querySelector(".quick-account-switcher")?.textContent).toContain("Gmail");
    expect(document.querySelector(".quick-account-switcher")?.textContent).toContain("Hotmail");
    expect(document.querySelector(".quick-account-switcher")?.textContent).not.toContain("user@gmail.example");
    expect(document.querySelector(".quick-account-switcher")?.textContent).not.toContain("user@hotmail.example");

    const hotmailButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".quick-account"))
      .find((button) => button.textContent?.includes("Hotmail"));
    expect(hotmailButton).toBeTruthy();
    await act(async () => {
      hotmailButton?.click();
    });

    await waitFor(() => expect(requests.some((url) => url.includes("accountId=outlook-hotmail-primary"))).toBe(true));
  });

  it("uses a three-slot width so the first three accounts fit on one screen", () => {
    const css = readFileSync(join(process.cwd(), "web/src/styles.css"), "utf8");
    expect(css).toContain("flex: 1 0 calc((100% - 16px) / 3);");
    expect(css).toContain("flex-basis: calc((100% - 16px) / 3);");
  });

  it("defaults to the Qifan mailbox when it is present", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url === "/api/accounts") {
        return jsonResponse({
          accounts: [
            account("gmail-primary", "Gmail", "user@gmail.example"),
            account("outlook-hotmail-primary", "Hotmail", "user@hotmail.example"),
            account("alimail-qifan-primary", "Qifan", "owner@qifan.example")
          ]
        });
      }
      if (url.includes("/api/folders?accountId=alimail-qifan-primary")) {
        return jsonResponse({ folders: [folder("qifan-inbox", "alimail-qifan-primary", "INBOX")] });
      }
      if (url.includes("/api/folders")) {
        return jsonResponse({ folders: [] });
      }
      if (url.includes("/api/messages")) {
        return jsonResponse({ messages: [], hasMore: false, nextOffset: 0 });
      }
      return jsonResponse({}, 404);
    }));

    const rootElement = document.getElementById("root");
    if (!rootElement) {
      throw new Error("missing root");
    }
    await act(async () => {
      createRoot(rootElement).render(<App />);
    });

    await waitFor(() => expect(requests.some((url) => url.includes("accountId=alimail-qifan-primary"))).toBe(true));
    const firstQuickAccount = document.querySelector<HTMLButtonElement>(".quick-account");
    expect(firstQuickAccount?.textContent).toContain("\u8d77\u51e1\u90ae\u7bb1");
    expect(firstQuickAccount?.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a refresh prompt when the served app version changes", async () => {
    vi.useFakeTimers();
    let versionChecks = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/app-version") {
        versionChecks += 1;
        return jsonResponse({ version: versionChecks === 1 ? "v1" : "v2" });
      }
      if (url === "/api/accounts") {
        return jsonResponse({ accounts: [account("gmail-primary", "Gmail", "user@gmail.example")] });
      }
      if (url.includes("/api/folders")) {
        return jsonResponse({ folders: [folder("gmail-inbox", "gmail-primary", "INBOX")] });
      }
      if (url.includes("/api/messages")) {
        return jsonResponse({ messages: [], hasMore: false, nextOffset: 0 });
      }
      return jsonResponse({}, 404);
    }));

    const rootElement = document.getElementById("root");
    if (!rootElement) {
      throw new Error("missing root");
    }
    await act(async () => {
      createRoot(rootElement).render(<App />);
    });
    await waitFor(() => expect(versionChecks).toBe(1));

    await act(async () => {
      vi.advanceTimersByTime(60000);
    });

    await waitFor(() => expect(document.querySelector(".refresh-banner")?.textContent).toContain("New version available"));
  });

  it("keeps a tap target for loading the next 50 messages when device scroll events are unreliable", async () => {
    const requests: string[] = [];
    let resolveSecondPage: ((value: Response) => void) | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url === "/api/accounts") {
        return jsonResponse({ accounts: [account("gmail-primary", "Gmail", "user@gmail.example")] });
      }
      if (url.includes("/api/folders")) {
        return jsonResponse({ folders: [folder("gmail-inbox", "gmail-primary", "INBOX")] });
      }
      if (url.includes("/api/messages") && url.includes("offset=0")) {
        return jsonResponse({ messages: [message("m1")], hasMore: true, nextOffset: 50 });
      }
      if (url.includes("/api/messages") && url.includes("offset=50")) {
        return new Promise<Response>((resolve) => {
          resolveSecondPage = resolve;
        });
      }
      if (url.includes("/api/messages/m")) {
        return jsonResponse({ message: { ...message("m1"), bodyText: "Synthetic body", attachments: [] } });
      }
      return jsonResponse({}, 404);
    }));

    const rootElement = document.getElementById("root");
    if (!rootElement) {
      throw new Error("missing root");
    }
    await act(async () => {
      createRoot(rootElement).render(<App />);
    });
    await waitFor(() => expect(document.querySelector(".load-more-button")?.textContent).toContain("Load 50 more messages"));

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".load-more-button")?.click();
    });
    await act(async () => {
      document.querySelector<HTMLDivElement>(".message-list")?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    await waitFor(() => expect(requests.some((url) => url.includes("offset=50"))).toBe(true));
    await act(async () => {
      resolveSecondPage?.(jsonResponse({ messages: [message("m2")], hasMore: false, nextOffset: 100 }));
    });
    await waitFor(() => expect(document.querySelectorAll(".message-row")).toHaveLength(2));
    expect(document.querySelector(".load-more-status")?.textContent || "").not.toContain("Loading 50 more messages");
  });
});

function account(id: string, accountLabel: string, displayAddress: string) {
  return {
    id,
    provider: id.split("-")[0],
    displayAddress,
    accountLabel,
    status: "connected",
    lastSyncAt: null
  };
}

function folder(id: string, accountId: string, displayName: string) {
  return {
    id,
    accountId,
    providerFolderId: "INBOX",
    displayName,
    folderType: "inbox",
    messageCount: 1,
    unreadCount: 0
  };
}

function message(id: string) {
  return {
    id,
    accountId: "gmail-primary",
    folderId: "gmail-inbox",
    provider: "gmail",
    providerMessageId: id,
    subject: "Synthetic subject",
    sender: "Sender",
    senderAddress: "sender@example.invalid",
    receivedAt: "2026-06-02T00:00:00.000Z",
    snippet: "Synthetic snippet",
    isRead: false,
    attachmentCount: 0,
    bodyState: "cached-text"
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  } as Response;
}

async function waitFor(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
  throw lastError;
}
