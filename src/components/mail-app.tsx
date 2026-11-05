"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Archive, ArrowDown, ArrowLeft, ArrowRight, Bot, ChevronRight, CircleAlert, Inbox, Layers, LockKeyhole, LogOut, Mail, Menu, Paperclip, PenLine, FileText, Reply, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Trash2, UserRound, X, Send, type LucideIcon } from "lucide-react";
import type { Folder, InboxKey, MailMessage, MailStatus, MailThread, ThreadAction, ThreadDetail, ThreadList } from "../lib/mail-types";
import { Button } from "./ui/button";
import { ComposeDialog, type ComposeSession } from "./compose-dialog";
import { DraftsPanel } from "./drafts-panel";
import { MailText, MessageLinkDestinations, plainTextLinks } from "./mail-text";
import { isolatedDocument, messageSandbox, type PreparedMessageDocument } from "../lib/message-document";
import { ThreadReadState, threadReadKey } from "./thread-read-state";
import { availableThreadActions, confirmsThreadAction, ThreadActionState, type ThreadActionAttempt } from "./thread-action-state";

const folders: { key: Folder; name: string; icon: LucideIcon }[] = [
  { key: "inbox", name: "Inbox", icon: Inbox },
  { key: "sent", name: "Sent", icon: Send },
  { key: "archive", name: "Archive", icon: Archive },
  { key: "spam", name: "Spam", icon: ShieldCheck },
  { key: "trash", name: "Trash", icon: Trash2 },
];
const actionLabels: Record<ThreadAction, { label: string; short: string; progress: string; success: string; icon: LucideIcon }> = {
  archive: { label: "Archive", short: "Archive", progress: "Archiving…", success: "Conversation archived.", icon: Archive },
  trash: { label: "Move to trash", short: "Trash", progress: "Moving to Trash…", success: "Moved to Trash.", icon: Trash2 },
  unread: { label: "Mark unread", short: "Mark unread", progress: "Marking unread…", success: "Marked unread.", icon: Mail },
  inbox: { label: "Move to inbox", short: "Inbox", progress: "Moving to Inbox…", success: "Moved to Inbox.", icon: Inbox },
};
function actionError(attempt: ThreadActionAttempt) {
  const subject = `“${attempt.thread.subject || "(No subject)"}”`;
  return attempt.action === "unread" ? `Couldn’t mark ${subject} unread.` : attempt.action === "archive" ? `Couldn’t archive ${subject}.` : `Couldn’t move ${subject} to ${attempt.action === "trash" ? "Trash" : "Inbox"}.`;
}

class RequestError extends Error { constructor(public login: boolean) { super("Mail request failed"); } }
async function request<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new RequestError(response.status === 401);
  return response.json() as Promise<T>;
}
const isAborted = (error: unknown) => error instanceof DOMException && error.name === "AbortError";
function senderName(sender: string) { return sender.replace(/<[^>]*>/g, "").replace(/^"|"$/g, "").trim() || sender; }
function initials(sender: string) { return senderName(sender).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase() || "?"; }
function dateLabel(value: string, full = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  if (full) return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}
function fileSize(bytes?: number) { return bytes == null ? "" : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

function IconButton({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return <Tooltip.Root><Tooltip.Trigger asChild><Button variant="ghost" size="icon" aria-label={label} {...props}>{children}</Button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" sideOffset={7}>{label}<Tooltip.Arrow className="tooltip-arrow" /></Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
}

function ThreadActions({ thread, pending, onAction, compact = false }: { thread: MailThread; pending?: ThreadAction; onAction: (action: ThreadAction) => void; compact?: boolean }) {
  return <div className={`thread-actions ${compact ? "thread-row-actions" : "reader-actions"}`} role="group" aria-label={compact ? `Actions for ${thread.subject || "(No subject)"}` : "Conversation actions"} aria-busy={Boolean(pending)}>
    {availableThreadActions(thread.folder).map(action => {
      const { label, short, progress, icon: Icon } = actionLabels[action];
      return <IconButton key={action} label={pending === action ? progress : label} className={`thread-action-button action-${action}`} disabled={Boolean(pending)} onClick={() => onAction(action)}>{pending === action ? <RefreshCw size={16} className="refreshing" aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />}{!compact && <span className="thread-action-label">{short}</span>}</IconButton>;
    })}
    {!compact && pending && <span className="sr-only" role="status">{actionLabels[pending].progress}</span>}
  </div>;
}

export function MailApp() {
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [statusLoading, setStatusLoading] = useState(true);
  const [inbox, setInbox] = useState<InboxKey>("all");
  const [folder, setFolder] = useState<Folder>("inbox");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [list, setList] = useState<ThreadList>({ threads: [], hasMore: false });
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState(false);
  const [selected, setSelected] = useState<MailThread | null>(null);
  const [readState] = useState(() => new ThreadReadState());
  const [actionState] = useState(() => new ThreadActionState());
  const [, updateThreadState] = useState(0);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [composeSession, setComposeSession] = useState<ComposeSession | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);
  const [draftRefresh, setDraftRefresh] = useState(0);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedButtonRef = useRef<HTMLButtonElement | null>(null);
  const selectedRef = useRef(selected);
  const accounts = [
    {key:'all',name:'All inboxes',short:`${status?.mailboxes.length || 0} inboxes`,icon:Layers},
    ...(status?.mailboxes || []).map(box=>({key:box.key,name:box.name,short:box.address,icon:UserRound})),
  ];
  const account = accounts.find(item => item.key === inbox) || accounts[0];
  const sender = status?.mailboxes.find(box => box.key === status.sendingInbox);

  const folderName = folders.find(item => item.key === folder)!.name;

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useEffect(() => {
    const controller = new AbortController();
    setStatusLoading(true);
    setStatusError(false);
    request<MailStatus>("/api/status", controller.signal).then(value => { if (controller.signal.aborted) return; setStatus(value); setNeedsLogin(value.requiresLogin); })
      .catch(error => { if (isAborted(error) || controller.signal.aborted) return; setStatusError(true); if (error instanceof RequestError && error.login) setNeedsLogin(true); })
      .finally(() => { if (!controller.signal.aborted) { setStatusLoading(false); } });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.trim()), 280); return () => window.clearTimeout(timer); }, [query]);
  const connected = status?.connected === true && !needsLogin;
  const canCompose = connected && status?.sendingEnabled === true && Boolean(sender);
  const loadList = useCallback(async (cursor?: string) => {
    if (!connected || showDrafts) { setListLoading(false); return; }
    // An explicit navigation/refresh supersedes an older request. Only the current response can commit state.
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setListLoading(true); setListError(false);
    const params = new URLSearchParams({ inbox, folder, q: search });
    if (cursor) params.set("cursor", cursor);
    try {
      const result = await request<ThreadList>(`/api/threads?${params}`, controller.signal);
      if (controller.signal.aborted || listRequest.current !== controller) return;
      setList(previous => ({ ...result, threads: cursor ? [...previous.threads, ...result.threads.filter(thread => !previous.threads.some(old => old.id === thread.id && old.inboxKey === thread.inboxKey))] : result.threads }));
      setLastUpdated(new Date());
    } catch (error) {
      if (!isAborted(error) && !controller.signal.aborted && listRequest.current === controller) {
        setListError(true); if (error instanceof RequestError && error.login) setNeedsLogin(true);
      }
    } finally { if (!controller.signal.aborted && listRequest.current === controller) setListLoading(false); }
  }, [connected, inbox, folder, search, showDrafts]);

  useEffect(() => { setSelected(null); setList({ threads: [], hasMore: false }); }, [inbox, folder, search]);
  useEffect(() => { void loadList(); return () => listRequest.current?.abort(); }, [loadList, refresh]);
  useEffect(() => {
    if (!connected || showDrafts) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible" && !listRequest.current?.signal.aborted && !listLoading) void loadList(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [connected, loadList, listLoading, showDrafts]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (composeSession || event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === "Escape" && selected && !(event.target instanceof HTMLInputElement)) closeReader();
    };
    window.addEventListener("keydown", keyboard); return () => window.removeEventListener("keydown", keyboard);
  }, [selected, composeSession]);

  function restoreListFocus() { window.setTimeout(() => { const trigger = selectedButtonRef.current; if (trigger?.isConnected && !trigger.disabled) trigger.focus(); else searchRef.current?.focus(); }, 0); }
  function closeReader() { setSelected(null); restoreListFocus(); }
  function navigate(nextInbox: InboxKey, nextFolder = folder) { setShowDrafts(false); setInbox(nextInbox); setFolder(nextFolder); setSelected(null); setNavigationOpen(false); setQuery(""); setSearch(""); setUnreadOnly(false); setActionNotice(null); }
  function compose() { if (!canCompose) return; setNavigationOpen(false); setComposeSession({ key: crypto.randomUUID() }); }
  function replyTo(thread: MailThread, message: MailMessage) {
    if (!canCompose || thread.inboxKey !== status?.sendingInbox) return;
    setComposeSession({ key: crypto.randomUUID(), reply: { threadId: thread.id, replyToEmailId: message.id, subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}` } });
  }
  async function saveRead(thread: MailThread) {
    if (actionState.pendingAction(thread)) return;
    const attempt = readState.begin(thread);
    if (!attempt) return;
    updateThreadState(value => value + 1);
    await actionState.enqueue(thread, async () => {
      try {
        const response = await fetch(`/api/threads/${encodeURIComponent(thread.inboxKey)}/${encodeURIComponent(thread.id)}/read`, { method: "POST", credentials: "same-origin", cache: "no-store" });
        if (response.status === 401) setNeedsLogin(true);
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok || !body || typeof body !== "object" || !("read" in body) || body.read !== true) throw new Error("Read status wasn’t saved.");
        if (readState.complete(attempt)) updateThreadState(value => value + 1);
      } catch {
        if (readState.fail(attempt)) updateThreadState(value => value + 1);
      }
    });
  }
  async function manageThread(thread: MailThread, action: ThreadAction) {
    const latest = list.threads.find(item => threadReadKey(item) === threadReadKey(thread)) || thread;
    const attempt = actionState.begin(actionState.apply(readState.apply(latest)), action);
    if (!attempt) return;
    setActionNotice(actionLabels[action].progress);
    updateThreadState(value => value + 1);
    try {
      await actionState.enqueue(attempt.thread, async () => {
        const response = await fetch(`/api/threads/${encodeURIComponent(attempt.thread.inboxKey)}/${encodeURIComponent(attempt.thread.id)}/manage`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
        if (response.status === 401) setNeedsLogin(true);
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok || !confirmsThreadAction(body, attempt.thread, action)) throw new Error("Conversation change wasn’t saved.");
        if (!actionState.complete(attempt)) return;
        if (action === "unread") readState.markUnread(attempt.thread);
        setActionNotice(actionLabels[action].success);
        updateThreadState(value => value + 1);
        // A late write must never close a different conversation opened during navigation.
        if (selectedRef.current && threadReadKey(selectedRef.current) === attempt.key) closeReader();
      });
    } catch {
      if (actionState.fail(attempt)) { setActionNotice(null); updateThreadState(value => value + 1); }
    }
  }
  function openThread(thread: MailThread) { if (actionState.pendingAction(thread)) return; setSelected(thread); void saveRead(thread); }
  const displayedThreads = list.threads.map(thread => actionState.apply(readState.apply(thread))).filter(thread => thread.folder === folder && (inbox === "all" || thread.inboxKey === inbox));
  const visibleThreads = unreadOnly ? displayedThreads.filter(thread => thread.unread) : displayedThreads;
  const unreadCount = displayedThreads.filter(thread => thread.unread).length;
  const failedReads = readState.failures();
  const failedActions = actionState.failures();
  const selectedThread = selected ? actionState.apply(readState.apply(selected)) : null;
  const sidebar = <>
    <a className="brand" href="/" aria-label="Letterdock home"><span className="brand-mark"><Mail size={20} strokeWidth={1.8} /></span><span>letterdock<span className="brand-period">.</span></span></a>
    {canCompose && <Button className="sidebar-compose" onClick={compose}><PenLine size={17} />Compose</Button>}
    <div className="section-label">Inboxes</div>
    <nav className="account-nav" aria-label="Mail accounts">
      {accounts.map(item => <button key={item.key} className={`account-button ${inbox === item.key ? "is-active" : ""}`} onClick={() => navigate(item.key)} aria-current={inbox === item.key ? "page" : undefined}><span className={`account-icon account-${item.key}`}><item.icon size={17} /></span><span><strong>{item.name}</strong>{item.key !== "all" && <small>{item.short}</small>}</span>{inbox === item.key && <span className="selection-dot" />}</button>)}
    </nav>
    <div className="sidebar-divider" />
    <nav className="folder-nav" aria-label="Mail folders">{folders.map(item => <button key={item.key} className={`folder-button ${!showDrafts && folder === item.key ? "is-active" : ""}`} onClick={() => navigate(inbox, item.key)} aria-current={!showDrafts && folder === item.key ? "page" : undefined}><item.icon size={17} /><span>{item.name}</span>{item.key === "inbox" && connected && folder === "inbox" && unreadCount > 0 && <span className="count-badge" aria-label={`${unreadCount} unread in loaded messages`}>{unreadCount}</span>}</button>)}{canCompose && <button className={`folder-button ${showDrafts ? "is-active" : ""}`} aria-current={showDrafts ? "page" : undefined} onClick={() => { setInbox(status?.sendingInbox || "all"); setShowDrafts(true); setSelected(null); setNavigationOpen(false); setQuery(""); setSearch(""); }}><FileText size={17} /><span>Drafts</span></button>}</nav>
    <div className="sidebar-bottom"><a className="settings-link" href="/setup"><Settings2 size={17} /><span>Connection</span><ChevronRight size={14} /></a>{status?.authenticated && <form action="/api/auth/logout" method="post"><button className="settings-link sign-out" type="submit"><LogOut size={17} /><span>Sign out</span></button></form>}<div className="owner"><span className="owner-avatar">LD</span><div><strong>{status?.ownerName || "Letterdock"}</strong><small>{connected ? "Connected" : "Not connected"}</small></div><span className={`connection-dot ${connected ? "connected" : ""}`} aria-hidden="true" /></div></div>
  </>;

  return <Tooltip.Provider delayDuration={450} skipDelayDuration={250}>
    <a className="skip-link" href="#mail-content">Skip to mail</a>
    <main className={`mail-app ${selected ? "has-selection" : ""}`}>
      <aside className="sidebar desktop-sidebar">{sidebar}</aside>
      <div className="workspace">
        <header className="workspace-header"><div className="workspace-breadcrumb"><Dialog.Root open={navigationOpen} onOpenChange={setNavigationOpen}><Dialog.Trigger asChild><Button variant="ghost" size="icon" className="mobile-menu" aria-label="Open mailbox navigation"><Menu size={21} /></Button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="nav-overlay" /><Dialog.Content className="nav-drawer"><Dialog.Title className="sr-only">Mailbox navigation</Dialog.Title><Dialog.Description className="sr-only">Choose an account or a mail folder.</Dialog.Description><Dialog.Close asChild><Button variant="ghost" size="icon" className="drawer-close" aria-label="Close mailbox navigation"><X size={20} /></Button></Dialog.Close>{sidebar}</Dialog.Content></Dialog.Portal></Dialog.Root><account.icon size={18} className="breadcrumb-icon" aria-hidden="true" /><strong>{account.name}</strong></div><div className="workspace-tools">{canCompose && <Button size="sm" className="header-compose" aria-label={`Compose from ${sender?.address || "your inbox"}`} onClick={compose}><PenLine size={16} /><span>Compose</span></Button>}<IconButton label="Refresh mail" onClick={() => setRefresh(value => value + 1)} disabled={statusLoading || listLoading}><RefreshCw size={18} className={statusLoading || listLoading ? "refreshing" : ""} /></IconButton></div></header>
        {connected && failedReads.length > 0 && <div className="read-save-error" role="alert"><CircleAlert size={17} /><span>Couldn’t save read status for “{failedReads[0].subject || "(No subject)"}”.{failedReads.length > 1 ? ` ${failedReads.length - 1} more conversation${failedReads.length > 2 ? "s" : ""} also need a retry.` : ""}</span><Button variant="ghost" size="sm" onClick={() => { for (const failed of failedReads) { const latest = list.threads.find(thread => threadReadKey(thread) === threadReadKey(failed)) || failed; void saveRead({ ...latest, unread: true }); } }}>Retry</Button></div>}
        {connected && failedActions.length > 0 && <div className="read-save-error thread-action-error" role="alert"><CircleAlert size={17} aria-hidden="true" /><span>{actionError(failedActions[0])}{failedActions.length > 1 ? ` ${failedActions.length - 1} more change${failedActions.length > 2 ? "s" : ""} also need a retry.` : ""}</span><Button variant="ghost" size="sm" onClick={() => void manageThread(failedActions[0].thread, failedActions[0].action)}>Retry</Button></div>}
        {needsLogin ? <div id="mail-content" className="full-state"><StateIcon icon={LockKeyhole} /><h1>Sign in to Letterdock</h1><a className="button button-primary button-default" href="/login">Sign in <ArrowRight size={16} /></a></div>
        : statusError && !status ? <div id="mail-content" className="full-state"><StateIcon icon={CircleAlert} /><h1>Couldn’t reach your inboxes.</h1><p>Your connection couldn’t be checked. Try again in a moment.</p><Button onClick={() => setRefresh(value => value + 1)} disabled={statusLoading}><RefreshCw size={16} /> Try again</Button></div>
        : !status && statusLoading ? <div id="mail-content" className="full-state" role="status"><StateIcon icon={Mail} /><h1>Opening Letterdock…</h1><span className="loading-line" /></div>
        : !connected ? <SetupState accounts={accounts.slice(1)} onRetry={() => setRefresh(value => value + 1)} busy={statusLoading} />
        : showDrafts && inbox === status?.sendingInbox ? <DraftsPanel refresh={draftRefresh + refresh} onOpen={id => setComposeSession({ key: crypto.randomUUID(), draftId: id })} onCompose={compose} onLogin={() => setNeedsLogin(true)} /> : <div id="mail-content" className="mail-columns">
          <section className="mail-list-pane" aria-label="Thread list"><div className="list-heading"><h1>{folderName}</h1><span className="result-count">{visibleThreads.length}{list.hasMore ? "+" : ""} {visibleThreads.length === 1 ? "conversation" : "conversations"}</span></div>
            <div className="search-wrap"><Search size={17} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your mail" aria-label="Search your mail" type="search" /><kbd>⌘ K</kbd></div>
            <div className="list-tabs"><div className="segmented-control" aria-label="Message filter"><button onClick={() => setUnreadOnly(false)} aria-pressed={!unreadOnly}>All mail</button><button onClick={() => setUnreadOnly(true)} aria-pressed={unreadOnly}>Unread {unreadCount > 0 && <span>{unreadCount}</span>}</button></div></div>
            {(listError || statusError) && <div className="inline-error" role="alert"><CircleAlert size={16} /><span>Mail couldn’t refresh. {list.threads.length > 0 ? "Showing the last loaded messages." : "Please try again."}</span><button onClick={() => setRefresh(value => value + 1)} disabled={listLoading || statusLoading}>Retry</button></div>}
            <div className="thread-list" aria-busy={listLoading}>
              {listLoading && list.threads.length === 0 ? <div className="list-skeleton" role="status" aria-label="Loading messages">{[0,1,2,3].map(item => <div key={item} className="thread-skeleton"><i /><span /><span /><span /></div>)}</div>
              : listError && list.threads.length === 0 ? <div className="list-empty"><StateIcon icon={CircleAlert} /><h2>Couldn’t load mail</h2></div> : visibleThreads.length === 0 ? <div className="list-empty"><StateIcon icon={search ? Search : Inbox} /><h2>{search ? "No matching mail" : unreadOnly ? "No unread mail" : folder === "sent" ? "No sent mail" : folder === "archive" ? "No archived mail" : folder === "spam" ? "No spam" : folder === "trash" ? "Trash is empty" : "Inbox is empty"}</h2>{search && <p>Try a different name or subject.</p>}{(search || unreadOnly) && <Button variant="outline" size="sm" onClick={() => { setQuery(""); setSearch(""); setUnreadOnly(false); }}>{search ? "Clear search" : "Show all mail"}</Button>}</div>
              : visibleThreads.map(thread => <div key={`${thread.inboxKey}:${thread.id}`} className={`thread-row ${selected?.id === thread.id && selected?.inboxKey === thread.inboxKey ? "is-selected" : ""}`} aria-busy={Boolean(actionState.pendingAction(thread))}><button className={`thread-card ${selected?.id === thread.id && selected?.inboxKey === thread.inboxKey ? "is-selected" : ""} ${thread.unread ? "is-unread" : ""}`} aria-current={selected?.id === thread.id && selected?.inboxKey === thread.inboxKey ? "true" : undefined} disabled={Boolean(actionState.pendingAction(thread))} onClick={event => { selectedButtonRef.current = event.currentTarget; openThread(thread); }}><div className="thread-card-top"><span className="thread-sender">{thread.unread && <span className="unread-dot" />}<span>{senderName(thread.sender)}</span></span><time dateTime={thread.updatedAt}>{dateLabel(thread.updatedAt)}</time></div><div className="thread-subject">{thread.subject || "(No subject)"}{thread.messageCount > 1 && <span>{thread.messageCount}</span>}</div><p className="thread-preview">{thread.preview || thread.sender}</p><div className="thread-meta"><span className={`inbox-tag tag-${thread.inboxKey}`}><span />{accounts.find(box => box.key === thread.inboxKey)?.name || thread.inboxKey}</span>{thread.unread && <span className="sr-only">Unread</span>}</div></button><ThreadActions thread={thread} pending={actionState.pendingAction(thread)} compact onAction={action => void manageThread(thread, action)} /></div>)}
              {list.hasMore && <div className="load-more"><Button variant="outline" size="sm" onClick={() => void loadList(list.nextCursor)} disabled={listLoading || !list.nextCursor}>{listLoading ? "Loading…" : "Load more messages"}<ArrowDown size={14} /></Button></div>}
            </div><footer className="list-footer"><span className="connection-dot connected" /><span role="status">{actionNotice || (listLoading ? "Checking for mail…" : lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "Connected")}</span></footer>
          </section>
          <section className="reader-pane" aria-label="Message reader">{selectedThread ? <ThreadReader inboxName={accounts.find(box => box.key === selectedThread.inboxKey)?.name || selectedThread.inboxKey} key={`${selectedThread.inboxKey}:${selectedThread.id}`} thread={selectedThread} refresh={refresh} canReply={canCompose && selectedThread.inboxKey === status?.sendingInbox} onReply={message => replyTo(selectedThread, message)} pendingAction={actionState.pendingAction(selectedThread)} onAction={action => void manageThread(selectedThread, action)} onBack={closeReader} onLogin={() => setNeedsLogin(true)} /> : <div className="reader-empty"><div className="empty-envelope"><Mail size={32} strokeWidth={1.4} /></div><h2>Select a conversation</h2></div>}</section>
        </div>}
      </div>
    </main>
    {composeSession && <ComposeDialog senderAddress={sender?.address || ""} key={composeSession.key} session={composeSession} onClose={() => setComposeSession(null)} onSaved={() => setDraftRefresh(value => value + 1)} onSent={() => { setDraftRefresh(value => value + 1); setRefresh(value => value + 1); }} onLogin={() => setNeedsLogin(true)} onCheckSent={() => { setComposeSession(null); navigate(status?.sendingInbox || "all", "sent"); setRefresh(value => value + 1); }} />}
  </Tooltip.Provider>;
}

function StateIcon({ icon: Icon }: { icon: LucideIcon }) { return <span className="state-icon"><Icon size={25} strokeWidth={1.5} /></span>; }
function SetupState({ onRetry, busy, accounts }: { onRetry: () => void; busy: boolean; accounts: {key:string;name:string;short:string;icon:LucideIcon}[] }) {
  return <div id="mail-content" className="setup-state"><div className="setup-body"><div className="setup-heading"><StateIcon icon={CircleAlert} /><h1>Reconnect your inboxes</h1><p>Letterdock couldn’t connect to your mail.</p></div><div className="setup-accounts" aria-label="Your inboxes">{accounts.map(item => <div key={item.key} className="setup-account"><span className={`account-icon account-${item.key}`}><item.icon size={19} /></span><div><strong>{item.name}</strong><span>{item.short}</span></div></div>)}</div><div className="setup-action"><Button onClick={onRetry} disabled={busy}><RefreshCw size={17} className={busy ? "refreshing" : ""} />{busy ? "Checking…" : "Try again"}</Button><a href="/setup" className="button button-outline button-default">Connection settings <ArrowRight size={16} /></a></div></div></div>;
}

function ThreadReader({ inboxName, thread, refresh, canReply, onReply, pendingAction, onAction, onBack, onLogin }: { inboxName: string; thread: MailThread; refresh: number; canReply: boolean; onReply: (message: MailMessage) => void; pendingAction?: ThreadAction; onAction: (action: ThreadAction) => void; onBack: () => void; onLogin: () => void }) {
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController(); setError(false); setDetail(null);
    request<ThreadDetail>(`/api/threads/${encodeURIComponent(thread.inboxKey)}/${encodeURIComponent(thread.id)}`, controller.signal).then(value => { if (!controller.signal.aborted) setDetail(value); }).catch(cause => { if (controller.signal.aborted || isAborted(cause)) return; setError(true); if (cause instanceof RequestError && cause.login) onLogin(); });
    return () => controller.abort();
    // The reader is keyed by inbox + thread; callbacks do not restart its request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id, thread.inboxKey, thread.updatedAt, thread.messageCount, retry, refresh]);
  useEffect(() => { if (window.matchMedia("(max-width: 760px)").matches) titleRef.current?.focus(); }, []);
  const replyMessage = detail?.messages.filter(message => message.direction === "inbound").at(-1) ?? detail?.messages.at(-1);
  return <><header className="reader-toolbar"><div className="reader-toolbar-context"><Button variant="ghost" size="sm" onClick={onBack} className="back-button"><ArrowLeft size={17} /><span>Back</span></Button><span className={`inbox-tag tag-${thread.inboxKey}`}><span />{inboxName}</span>{canReply && replyMessage && <Button variant="outline" size="sm" className="thread-reply" onClick={() => onReply(replyMessage)}><Reply size={16} />Reply</Button>}</div><ThreadActions thread={thread} pending={pendingAction} onAction={onAction} /></header><div className="reader-scroll"><div className="conversation-heading"><h2 ref={titleRef} tabIndex={-1}>{thread.subject || "(No subject)"}</h2><span>{thread.messageCount} {thread.messageCount === 1 ? "message" : "messages"} <span aria-hidden="true">·</span> {dateLabel(thread.updatedAt)}</span></div>{error ? <div className="reader-error" role="alert"><StateIcon icon={CircleAlert} /><h3>Couldn’t open this conversation</h3><Button variant="outline" onClick={() => setRetry(value => value + 1)}>Try again</Button></div> : !detail ? <div className="message-loading" role="status"><span className="loading-line" /><p>Opening conversation…</p></div> : detail.messages.length === 0 ? <div className="reader-error"><p>No messages in this conversation.</p></div> : detail.messages.map(message => <Message key={message.id} message={message} onReply={canReply ? () => onReply(message) : undefined} />)}</div></>;
}

export function Message({ message, onReply }: { message: MailMessage; onReply?: () => void }) {
  const [formatted, setFormatted] = useState(Boolean(message.safeHtml));
  const [prepared, setPrepared] = useState<{ source: string; document: PreparedMessageDocument } | null>(null);
  const [formatError, setFormatError] = useState(false);
  const [showRecipients, setShowRecipients] = useState(false);
  const recipientId = useId();
  useEffect(() => {
    if (!message.safeHtml) return;
    setFormatError(false);
    try { setPrepared({ source: message.safeHtml, document: isolatedDocument(message.safeHtml) }); }
    catch { setFormatError(true); }
  }, [message.safeHtml]);
  const document = prepared && prepared.source === message.safeHtml ? prepared.document : null;
  const links = useMemo(() => formatted ? document?.links || [] : plainTextLinks(message.text), [formatted, document, message.text]);
  return <article className="message"><header className="message-header"><span className="sender-avatar">{initials(message.from)}</span><div className="sender-info"><strong>{senderName(message.from)}</strong><button className="recipient-toggle" aria-expanded={showRecipients} aria-controls={recipientId} onClick={() => setShowRecipients(value => !value)}>to {message.to.length === 1 ? senderName(message.to[0]) : `${message.to.length} recipients`}<ChevronRight size={13} className={showRecipients ? "rotated" : ""} /></button></div><time dateTime={message.receivedAt}>{dateLabel(message.receivedAt, true)}</time></header>{showRecipients && <dl id={recipientId} className="recipient-details"><dt>From</dt><dd>{message.from}</dd><dt>To</dt><dd>{message.to.join(", ") || "Not provided"}</dd>{message.cc.length > 0 && <><dt>Cc</dt><dd>{message.cc.join(", ")}</dd></>}</dl>}{message.safeHtml && <div className="message-format"><div className="segmented-control format-switch" aria-label="Message display"><button aria-pressed={formatted} aria-label="Show formatted message" onClick={() => setFormatted(true)}>Formatted</button><button aria-pressed={!formatted} aria-label="Show plain text" onClick={() => setFormatted(false)}>Plain text</button></div><span className="content-blocked" title="Remote images and tracking are blocked. Links open in a new tab."><ShieldCheck size={13} />Images blocked</span></div>}{formatted && message.safeHtml ? document ? <iframe className="message-frame" title={`Formatted message from ${senderName(message.from)}`} sandbox={messageSandbox} referrerPolicy="no-referrer" srcDoc={document.html} /> : <p className="format-note" role="status">{formatError ? "Couldn’t display this message. Try Plain text." : "Preparing formatted message…"}</p> : <div className="message-text"><MailText text={message.text || (message.safeHtml ? "No plain-text version. Choose Formatted to read this message." : "This message has no text content.")} /></div>}<MessageLinkDestinations links={links} />{message.attachments.length > 0 && <section className="attachments" aria-label="Attachment details"><h3><Paperclip size={15} />Attachments <span>{message.attachments.length}</span></h3><div className="attachment-list">{message.attachments.map(attachment => <div className="attachment" key={attachment.id}><span className="attachment-icon"><Paperclip size={17} /></span><div><strong>{attachment.filename || "Untitled attachment"}</strong><span>{[fileSize(attachment.size), attachment.contentType].filter(Boolean).join(" · ") || "Attachment"}</span></div></div>)}</div><p>Downloads unavailable.</p></section>}{onReply && <footer className="message-reply"><Button variant="outline" onClick={onReply}><Reply size={16} />Reply</Button></footer>}</article>;
}
