import { describe, expect, it } from "vitest";
import { projectMessageSummary } from "../service/privacy-projection-service";

describe("privacy projection", () => {
  it("returns bounded message metadata without full body or local paths", () => {
    const summary = projectMessageSummary({
      id: "msg-1",
      accountId: "acct-1",
      folderId: "folder-1",
      provider: "outlook",
      providerMessageId: "provider-1",
      subject: "A".repeat(220),
      senderDisplay: "Sender",
      senderAddressBounded: "sender@example.local",
      receivedAt: "2026-05-31T00:00:00.000Z",
      isRead: false,
      hasAttachments: false,
      attachmentCount: 0,
      bodyState: "metadata-only"
    });

    expect(summary.subject.length).toBeLessThanOrEqual(160);
    expect(summary).not.toHaveProperty("providerMessageId");
    expect(summary).not.toHaveProperty("body");
    expect(JSON.stringify(summary)).not.toContain("C:\\");
  });
});

