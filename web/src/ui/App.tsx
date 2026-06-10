import { Archive, Bell, CheckCheck, ChevronLeft, Inbox, Mail, MailOpen, Menu, Paperclip, RefreshCw, Search, Settings, Star, Trash2, X } from "lucide-react";
import type { FormEvent, TouchEvent, UIEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

interface AccountSummary {
  id: string;
  provider: string;
  displayAddress: string;
  accountLabel: string;
  status: string;
  lastSyncAt: string | null;
}

interface FolderSummary {
  id: string;
  accountId: string;
  providerFolderId: string;
  displayName: string;
  folderType: string;
  messageCount: number;
  unreadCount: number;
}

interface MessageSummary {
  id: string;
  accountId: string;
  folderId: string;
  provider: string;
  subject: string;
  sender: string;
  receivedAt: string;
  isRead: boolean;
  attachmentCount: number;
  bodyState: string;
}

interface MessageDetail extends MessageSummary {
  senderAddress: string | null;
  bodyText: string;
  bodyExcerpt: string;
  contentSource: string | null;
  attachments: Array<{
    id: string;
    filename: string;
    contentType: string | null;
    sizeBytes: number | null;
    availabilityState: string;
  }>;
}

export function App() {
  const initialPluginActionRoute = useMemo(readInitialPluginActionRoute, []);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [activeAccountId, setActiveAccountId] = useState("");
  const [activeFolderId, setActiveFolderId] = useState("");
  const [activeMessageId, setActiveMessageId] = useState("");
  const [activeMessage, setActiveMessage] = useState<MessageDetail | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Loading local mailbox");
  const [accountState, setAccountState] = useState<"loading" | "idle" | "error">("loading");
  const [folderState, setFolderState] = useState<"loading" | "idle" | "error">("loading");
  const [listState, setListState] = useState<"idle" | "loading" | "error">("loading");
  const [listAppendState, setListAppendState] = useState<"idle" | "loading" | "error">("idle");
  const [messageOffset, setMessageOffset] = useState(0);
  const [messageHasMore, setMessageHasMore] = useState(false);
  const [refreshAvailable, setRefreshAvailable] = useState(false);
  const [folderPaneOpen, setFolderPaneOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const messageRequestSeq = useRef(0);
  const appVersion = useRef<string | null>(null);
  const pluginActionRouteApplied = useRef(false);

  const activeAccount = useMemo(() => accounts.find((account) => account.id === activeAccountId), [accounts, activeAccountId]);
  const activeFolder = useMemo(() => folders.find((folder) => folder.id === activeFolderId), [activeFolderId, folders]);
  const unreadCount = useMemo(() => messages.filter((message) => !message.isRead).length, [messages]);
  const isEmbedded = useMemo(() => new URLSearchParams(window.location.search).get("embed") === "hermes", []);
  const listStatusText = listState === "loading" ? LOADING_MESSAGES_LABEL : `${messages.length}${messageHasMore ? "+" : ""} local messages`;

  useEffect(() => {
    applyHostAppearance();
    void loadAccounts();
    void checkAppVersion();
    const timer = window.setInterval(() => void checkAppVersion(), APP_VERSION_CHECK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isEmbedded) {
      return;
    }
    const route = activeMessageId && detailOpen
      ? { name: "message", messageId: activeMessageId }
      : { name: activeFolder?.displayName || "mailbox", folderId: activeFolderId };
    window.parent.postMessage({
      type: "email.plugin.navigation",
      version: 1,
      canGoBack: Boolean(detailOpen || folderPaneOpen),
      route
    }, "*");
  }, [activeFolder?.displayName, activeFolderId, activeMessageId, detailOpen, folderPaneOpen, isEmbedded]);

  useEffect(() => {
    if (!isEmbedded) {
      return;
    }
    function handleMessage(event: MessageEvent) {
      if (event.data?.type !== "hermes.plugin.back") {
        return;
      }
      if (detailOpen) {
        setDetailOpen(false);
        window.parent.postMessage({ type: "email.plugin.back_result", version: 1, handled: true, canGoBack: folderPaneOpen }, "*");
        return;
      }
      if (folderPaneOpen) {
        setFolderPaneOpen(false);
        window.parent.postMessage({ type: "email.plugin.back_result", version: 1, handled: true, canGoBack: false }, "*");
        return;
      }
      window.parent.postMessage({ type: "email.plugin.back_result", version: 1, handled: false, canGoBack: false }, "*");
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [detailOpen, folderPaneOpen, isEmbedded]);

  useEffect(() => {
    if (activeAccountId) {
      void loadFolders(activeAccountId);
    }
  }, [activeAccountId]);

  useEffect(() => {
    void loadMessages({ reset: true });
  }, [activeFolderId]);

  useEffect(() => {
    if (activeMessageId) {
      void loadMessage(activeMessageId);
    } else {
      setActiveMessage(null);
    }
  }, [activeMessageId]);

  useEffect(() => {
    if (!initialPluginActionRoute || pluginActionRouteApplied.current || folderState !== "idle") {
      return;
    }
    pluginActionRouteApplied.current = true;
    applyInitialPluginActionRoute(initialPluginActionRoute);
  }, [activeFolderId, folderState, folders, initialPluginActionRoute]);

  async function loadAccounts() {
    setAccountState("loading");
    setFolderState("loading");
    setListState("loading");
    try {
      const payload = await fetchJson<{ accounts: AccountSummary[] }>("/api/accounts");
      const sortedAccounts = sortAccountsForDefaultMailbox(payload.accounts);
      setAccounts(sortedAccounts);
      if (sortedAccounts[0]) {
        setActiveAccountId(sortedAccounts[0].id);
      } else {
        setFolderState("idle");
        setListState("idle");
      }
      setAccountState("idle");
      setStatus(sortedAccounts.length ? "Connected to local SQLite mail store" : "No local accounts found");
    } catch (error) {
      setAccountState("error");
      setFolderState("error");
      setListState("error");
      setStatus(error instanceof Error ? error.message : "Account list failed to load");
    }
  }

  async function checkAppVersion() {
    try {
      const payload = await fetchJson<{ version: string }>("/api/app-version");
      if (!appVersion.current) {
        appVersion.current = payload.version;
        return;
      }
      if (payload.version !== appVersion.current) {
        setRefreshAvailable(true);
      }
    } catch {
      // Version checks should not interrupt mailbox use.
    }
  }

  async function loadFolders(accountId: string) {
    setFolderState("loading");
    setFolders([]);
    setMessages([]);
    setActiveFolderId("");
    setActiveMessageId("");
    setListState("loading");
    try {
      const payload = await fetchJson<{ folders: FolderSummary[] }>(`/api/folders?accountId=${encodeURIComponent(accountId)}`);
      const sorted = [...payload.folders].sort(compareFolders);
      setFolders(sorted);
      setFolderState("idle");
      const inbox = sorted.find(isInboxFolder) || sorted[0];
      if (inbox) {
        setActiveFolderId(inbox.id);
      } else {
        setListState("idle");
      }
    } catch (error) {
      setFolderState("error");
      setListState("error");
      setStatus(error instanceof Error ? error.message : "Folder list failed to load");
    }
  }

  async function loadMessages(input: { searchQuery?: string; reset?: boolean } = {}) {
    const searchQuery = input.searchQuery ?? query;
    const reset = input.reset ?? false;
    const offset = reset ? 0 : messageOffset;
    if (reset) {
      setListState("loading");
      setListAppendState("idle");
      setMessageOffset(0);
      setMessageHasMore(false);
    } else {
      if (listAppendState === "loading" || !messageHasMore) {
        return;
      }
      setListAppendState("loading");
    }
    if (!searchQuery.trim() && !activeFolderId) {
      return;
    }
    const requestId = ++messageRequestSeq.current;
    const params = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE), offset: String(offset) });
    if (searchQuery.trim()) {
      params.set("query", searchQuery.trim());
    } else if (activeFolderId) {
      params.set("folderId", activeFolderId);
    }
    try {
      const payload = await fetchJson<{ messages: MessageSummary[]; hasMore?: boolean; nextOffset?: number }>(`/api/messages?${params.toString()}`);
      if (requestId !== messageRequestSeq.current) {
        return;
      }
      setMessages((current) => reset ? payload.messages : [...current, ...payload.messages]);
      if (reset) {
        setActiveMessageId(payload.messages[0]?.id || "");
        setDetailOpen(false);
      }
      setMessageOffset(payload.nextOffset ?? offset + payload.messages.length);
      setMessageHasMore(Boolean(payload.hasMore));
      setListState("idle");
      setListAppendState("idle");
    } catch (error) {
      if (requestId !== messageRequestSeq.current) {
        return;
      }
      if (reset) {
        setMessages([]);
        setActiveMessageId("");
        setListState("error");
      } else {
        setListAppendState("error");
      }
      setStatus(error instanceof Error ? error.message : "Message list failed to load");
    }
  }

  async function loadMessage(messageId: string) {
    const payload = await fetchJson<{ message: MessageDetail }>(`/api/messages/${encodeURIComponent(messageId)}`);
    setActiveMessage(payload.message);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    void loadMessages({ searchQuery: query, reset: true });
  }

  function maybeLoadMoreMessages(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 320) {
      void loadMessages({ reset: false });
    }
  }

  function selectAccount(accountId: string) {
    if (accountId === activeAccountId) {
      return;
    }
    setQuery("");
    setDetailOpen(false);
    setFolderPaneOpen(false);
    setActiveAccountId(accountId);
  }

  function selectFolder(folderId: string) {
    setQuery("");
    setActiveFolderId(folderId);
    setFolderPaneOpen(false);
  }

  function selectMessage(messageId: string) {
    setActiveMessageId(messageId);
    setDetailOpen(true);
  }

  function applyInitialPluginActionRoute(route: string) {
    setDetailOpen(false);
    setFolderPaneOpen(false);
    if (route === "inbox") {
      const inbox = folders.find(isInboxFolder) || folders[0];
      setQuery("");
      if (inbox && inbox.id !== activeFolderId) setActiveFolderId(inbox.id);
      setStatus("Inbox");
      return;
    }
    if (route === "needs_reply") {
      setQuery("unread");
      void loadMessages({ searchQuery: "unread", reset: true });
      setStatus("Searching unread mail");
      return;
    }
    if (route === "search") {
      setQuery("");
      setStatus("Search local mail");
      return;
    }
    if (route === "digest") {
      setQuery("");
      setStatus("Digest opens the local mailbox list; AI digest runs from Home AI chat.");
      return;
    }
    if (route === "cleanup") {
      setQuery("");
      setStatus("Search first, then delete local mailbox entries from the message detail.");
      return;
    }
    if (route === "compose") {
      setStatus("Compose is not available in this local mailbox UI yet.");
    }
  }

  async function setActiveReadState(isRead: boolean) {
    if (!activeMessage) {
      return;
    }
    await fetchJson(`/api/messages/${encodeURIComponent(activeMessage.id)}/read`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: activeMessage.accountId, isRead })
    });
    setMessages((current) => current.map((message) => message.id === activeMessage.id ? { ...message, isRead } : message));
    setActiveMessage({ ...activeMessage, isRead });
  }

  async function deleteActiveMessage() {
    if (!activeMessage) {
      return;
    }
    if (!window.confirm("Remove this message from the local mailbox view?")) {
      return;
    }
    await fetchJson(`/api/messages/${encodeURIComponent(activeMessage.id)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: activeMessage.accountId })
    });
    const remaining = messages.filter((message) => message.id !== activeMessage.id);
    setMessages(remaining);
    setActiveMessageId(remaining[0]?.id || "");
    setDetailOpen(false);
  }

  function recordTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleTouchEnd(event: TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) {
      return;
    }
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (deltaX < 70 || Math.abs(deltaY) > 60) {
      return;
    }
    if (detailOpen) {
      setDetailOpen(false);
    } else if (folderPaneOpen) {
      setFolderPaneOpen(false);
    }
  }

  return (
    <main className={`mail-shell ${folderPaneOpen ? "folders-open" : ""} ${detailOpen ? "detail-open" : ""}`} onTouchStart={recordTouchStart} onTouchEnd={handleTouchEnd}>
      <aside className="rail" aria-label="App navigation">
        <button className="icon-button active" aria-label="Mail"><Mail size={20} /></button>
        <button className="icon-button" aria-label="Notifications"><Bell size={20} /></button>
        <button className="icon-button" aria-label="Settings"><Settings size={20} /></button>
      </aside>

      <section className="folder-pane" aria-label="Mailbox folders">
        <div className="pane-header">
          <button className="icon-button compact" aria-label="Close folders" onClick={() => setFolderPaneOpen(false)}><X size={18} /></button>
          <div>
            <h1>Email</h1>
            <p>{status}</p>
          </div>
        </div>

        <div className="account-stack">
          {accountState === "loading" ? (
            <div className="pane-placeholder">Loading accounts</div>
          ) : accountState === "error" ? (
            <div className="pane-placeholder">Account list failed to load</div>
          ) : accounts.map((account) => (
            <button className={`account-row ${account.status} ${account.id === activeAccountId ? "selected-account" : ""}`} key={account.id} onClick={() => selectAccount(account.id)}>
              <span className="account-dot" />
              <span>
                <strong>{account.accountLabel}</strong>
                <small>{account.displayAddress}</small>
              </span>
            </button>
          ))}
        </div>

        <nav className="folder-list">
          {folderState === "loading" ? (
            <div className="pane-placeholder">Loading folders</div>
          ) : folderState === "error" ? (
            <div className="pane-placeholder">Folder list failed to load</div>
          ) : folders.map((folder) => (
            <button className={folder.id === activeFolderId ? "selected" : ""} key={folder.id} onClick={() => selectFolder(folder.id)}>
              {isInboxFolder(folder) ? <Inbox size={17} /> : <Archive size={17} />}
              <span>{folder.displayName}</span>
              <small>{folder.unreadCount || folder.messageCount}</small>
            </button>
          ))}
        </nav>
      </section>

      <section className="message-pane" aria-label="Message list">
        <header className="topbar">
          <button className="icon-button compact mobile-only" aria-label="Folders" onClick={() => setFolderPaneOpen(true)}><Menu size={18} /></button>
          <form className="search-box" onSubmit={submitSearch}>
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search local mail" aria-label="Search local mail" />
          </form>
          <button className="icon-button compact" aria-label="Refresh" onClick={() => void loadMessages({ reset: true })}><RefreshCw size={18} /></button>
        </header>

        <div className="message-toolbar-stack">
          {refreshAvailable ? (
            <section className="refresh-banner" role="status" aria-live="polite">
              <span>New version available</span>
              <button type="button" onClick={() => window.location.reload()}>Refresh</button>
            </section>
          ) : null}

          <div className="quick-account-switcher" aria-label="Switch mailbox account">
            {accountState === "loading" ? (
              <div className="quick-account-placeholder">Loading accounts</div>
            ) : accountState === "error" ? (
              <div className="quick-account-placeholder">Accounts unavailable</div>
            ) : accounts.map((account) => (
              <button
                className={`quick-account ${account.id === activeAccountId ? "active" : ""}`}
                key={account.id}
                onClick={() => selectAccount(account.id)}
                aria-pressed={account.id === activeAccountId}
                title={account.displayAddress}
              >
                <span className="quick-account-label">
                  <strong>{quickAccountLabel(account)}</strong>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="list-title">
          <div>
            <h2>{query.trim() ? "Search" : activeFolder?.displayName || "Mailbox"}</h2>
            <p>{activeAccount?.accountLabel || "No account"} / {listStatusText}</p>
          </div>
          <span>{unreadCount} unread</span>
        </div>

        <div className="message-list" onScroll={maybeLoadMoreMessages}>
          {listState === "loading" ? (
            <div className="list-empty">
              <strong>{LOADING_MESSAGES_LABEL}</strong>
              <span>Background sync can continue while the local cache is opening.</span>
            </div>
          ) : listState === "error" ? (
            <div className="list-empty">Message list failed to load</div>
          ) : messages.length === 0 ? (
            <div className="list-empty">No local messages in this view</div>
          ) : (
            <>
              {messages.map((message) => (
                <button className={`message-row ${message.id === activeMessageId ? "active" : ""} ${message.isRead ? "read" : "unread"}`} key={message.id} onClick={() => selectMessage(message.id)}>
                  <span className="read-marker" />
                  <span className="message-main">
                    <span className="message-meta">
                      <strong>{message.sender}</strong>
                      <time>{formatTime(message.receivedAt)}</time>
                    </span>
                    <span className="subject-line">{message.subject}</span>
                    <span className="message-foot">
                      {message.attachmentCount ? <Paperclip size={14} /> : <Star size={14} />}
                      {message.attachmentCount ? `${message.attachmentCount} attachment metadata` : message.bodyState}
                    </span>
                  </span>
                </button>
              ))}
              {messageHasMore || listAppendState !== "idle" ? (
                <div className="load-more-status">
                  {listAppendState === "loading" ? (
                    <span>Loading 50 more messages</span>
                  ) : (
                    <button type="button" className="load-more-button" onClick={() => void loadMessages({ reset: false })} disabled={!messageHasMore}>
                      {listAppendState === "error" ? "Retry loading 50 more messages" : "Load 50 more messages"}
                    </button>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>

      <article className="reading-pane" aria-label="Message detail">
        <header className="reading-actions">
          <button className="icon-button compact mobile-only" aria-label="Back to messages" onClick={() => setDetailOpen(false)}><ChevronLeft size={18} /></button>
          <button className="icon-button compact" aria-label="Open message" title="Open message"><MailOpen size={18} /></button>
          <button className="icon-button compact" aria-label="Mark read" title="Mark read" onClick={() => void setActiveReadState(true)}><CheckCheck size={18} /></button>
          <button className="icon-button compact" aria-label="Mark unread" title="Mark unread" onClick={() => void setActiveReadState(false)}><Mail size={18} /></button>
          <button className="icon-button compact" aria-label="Archive placeholder" title="Archive requires remote write scope"><Archive size={18} /></button>
          <button className="icon-button compact danger" aria-label="Delete locally" title="Remove locally" onClick={() => void deleteActiveMessage()}><Trash2 size={18} /></button>
        </header>
        {activeMessage ? (
          <div className="message-detail">
            <p className="provider-chip">{activeMessage.provider}</p>
            <h2>{activeMessage.subject}</h2>
            <div className="sender-card">
              <div className="avatar">{initials(activeMessage.sender)}</div>
              <div>
                <strong>{activeMessage.sender}</strong>
                <p>{activeMessage.senderAddress || "bounded sender"}</p>
              </div>
              <time>{new Date(activeMessage.receivedAt).toLocaleString()}</time>
            </div>
            <p className="body-placeholder">{activeMessage.bodyText || activeMessage.bodyExcerpt || "No local body text cached for this message."}</p>
            {activeMessage.attachments.length > 0 ? (
              <div className="attachment-list">
                {activeMessage.attachments.map((attachment) => (
                  <div className="attachment-row" key={attachment.id}>
                    <Paperclip size={15} />
                    <span>{attachment.filename}</span>
                    <small>{formatBytes(attachment.sizeBytes)} / {attachment.availabilityState}</small>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="empty-detail">Select a message</div>
        )}
      </article>
    </main>
  );
}

const LOADING_MESSAGES_LABEL = "\u6b63\u5728\u52a0\u8f7d\u90ae\u4ef6...";
const APP_VERSION_CHECK_MS = 60000;
const MESSAGE_PAGE_SIZE = 50;
const SUPPORTED_PLUGIN_ACTION_ROUTES = new Set(["inbox", "needs_reply", "search", "compose", "digest", "cleanup"]);

function readInitialPluginActionRoute() {
  const params = new URLSearchParams(window.location.search);
  const route = String(params.get("pluginRoute") || params.get("route") || params.get("pluginActionId") || "").trim().toLowerCase();
  return SUPPORTED_PLUGIN_ACTION_ROUTES.has(route) ? route : "";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { accept: "application/json", ...(init?.headers || {}) } });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" }).format(new Date(value));
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "M";
}

function quickAccountLabel(account: AccountSummary) {
  const provider = account.provider.toLowerCase();
  const label = account.accountLabel.trim();
  if (provider === "gmail" || label.toLowerCase().includes("gmail")) {
    return "Gmail";
  }
  if (provider.includes("outlook") || provider.includes("hotmail") || label.toLowerCase().includes("hotmail") || label.toLowerCase().includes("outlook")) {
    return "Hotmail";
  }
  if (provider.includes("alimail") || provider.includes("qifan") || label.toLowerCase().includes("qifan")) {
    return "\u8d77\u51e1\u90ae\u7bb1";
  }
  return label || account.provider;
}

function sortAccountsForDefaultMailbox(accounts: AccountSummary[]) {
  return accounts
    .map((account, index) => ({ account, index }))
    .sort((a, b) => accountPriority(a.account) - accountPriority(b.account) || a.index - b.index)
    .map((entry) => entry.account);
}

function accountPriority(account: AccountSummary) {
  return isQifanAccount(account) ? 0 : 10;
}

function isQifanAccount(account: AccountSummary) {
  const provider = account.provider.toLowerCase();
  const label = account.accountLabel.toLowerCase();
  const address = account.displayAddress.toLowerCase();
  return provider.includes("alimail") || provider.includes("qifan") || label.includes("qifan") || label.includes("\u8d77\u51e1") || address.includes("qifan");
}

function formatBytes(value: number | null) {
  if (!value) {
    return "unknown size";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function compareFolders(a: FolderSummary, b: FolderSummary) {
  return folderPriority(a) - folderPriority(b) || a.displayName.localeCompare(b.displayName);
}

function folderPriority(folder: FolderSummary) {
  if (isInboxFolder(folder)) {
    return 0;
  }
  const id = folder.providerFolderId.toLowerCase();
  const name = folder.displayName.toLowerCase();
  if (id.includes("focused") || name === "chat") {
    return 1;
  }
  if (id.includes("sent") || name.includes("sent") || name === "\u5df2\u53d1\u9001\u90ae\u4ef6") {
    return 2;
  }
  if (id.includes("draft") || name.includes("draft") || name === "\u8349\u7a3f") {
    return 3;
  }
  if (id.includes("archive") || name.includes("archive") || name === "\u5b58\u6863") {
    return 4;
  }
  if (id.includes("deleted") || name.includes("deleted") || name === "\u5df2\u5220\u9664\u90ae\u4ef6") {
    return 5;
  }
  return 10;
}

function isInboxFolder(folder: FolderSummary) {
  return folder.folderType === "inbox" || folder.providerFolderId.toLowerCase() === "inbox" || folder.displayName === "\u6536\u4ef6\u7bb1";
}

function applyHostAppearance() {
  const params = new URLSearchParams(window.location.search);
  const theme = params.get("pluginTheme");
  const fontSize = params.get("pluginFontSize");
  if (theme && ["dark", "light"].includes(theme)) {
    document.documentElement.dataset.theme = theme;
  }
  if (fontSize && ["small", "default", "large", "xlarge", "xxlarge"].includes(fontSize)) {
    document.documentElement.dataset.fontSize = fontSize;
  }
}
