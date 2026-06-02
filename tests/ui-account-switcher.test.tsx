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
