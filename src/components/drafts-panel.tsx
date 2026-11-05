"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, CircleAlert, FileText, Paperclip, PenLine, Search } from "lucide-react";
import type { DraftList } from "../lib/mail-types";
import { draftRequest, DraftRequestError } from "./draft-api";
import { Button } from "./ui/button";

export function DraftsPanel({ refresh, onOpen, onCompose, onLogin }: { refresh: number; onOpen: (id: string) => void; onCompose: () => void; onLogin: () => void }) {
  const [list, setList] = useState<DraftList>({ drafts: [], hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const active = useRef<AbortController | null>(null);
  const login = useRef(onLogin); login.current = onLogin;
  const load = useCallback(async (after?: string) => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setLoading(true); setError("");
    try {
      const result = await draftRequest<DraftList>(`/api/drafts${after ? `?after=${encodeURIComponent(after)}` : ""}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setList(previous => ({ ...result, drafts: after ? [...previous.drafts, ...result.drafts.filter(draft => !previous.drafts.some(old => old.id === draft.id))] : result.drafts }));
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Saved drafts couldn’t load.");
      if (cause instanceof DraftRequestError && cause.status === 401) login.current();
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => active.current?.abort(); }, [load, refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible" && !loading) void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load, loading]);
  const search = query.trim().toLowerCase();
  const drafts = list.drafts.filter(draft => !search || [draft.subject, draft.snippet, ...draft.to, ...draft.cc, ...draft.bcc].join(" ").toLowerCase().includes(search));
  return <section className="drafts-panel" id="mail-content" aria-labelledby="drafts-heading">
    <header className="drafts-heading"><h1 id="drafts-heading">Drafts</h1><span className="result-count">{drafts.length}{list.hasMore ? "+" : ""} saved</span></header>
    <div className="drafts-tools"><div className="search-wrap"><Search size={18} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search drafts" aria-label="Search loaded drafts" /></div></div>
    {error && <div className="inline-error" role="alert"><CircleAlert size={16} /><span>{error}{list.drafts.length > 0 ? " Showing the last loaded drafts." : ""}</span><button onClick={() => void load()} disabled={loading}>Retry</button></div>}
    <div className="drafts-list" aria-busy={loading}>
      {loading && list.drafts.length === 0 ? <div className="compose-loading" role="status"><span className="loading-line" /><p>Opening drafts…</p></div> : drafts.length === 0 ? <div className="list-empty"><span className="state-icon">{error ? <CircleAlert size={25} /> : <FileText size={25} />}</span><h2>{error ? "Couldn’t load drafts" : search ? "No matching drafts" : "No saved drafts"}</h2>{search && <p>Try a different subject or recipient.</p>}{!error && (search ? <Button variant="outline" onClick={() => setQuery("")}>Clear search</Button> : <Button variant="outline" onClick={onCompose}><PenLine size={16} />New message</Button>)}</div> : drafts.map(draft => <button className="draft-row" key={draft.id} onClick={() => onOpen(draft.id)}><span className="draft-row-icon"><FileText size={18} /></span><span className="draft-row-main"><strong>{draft.subject || "(No subject)"}</strong><span>To: {draft.to.join(", ") || "No recipients"}</span><span className="draft-row-preview">{draft.snippet || "No message text"}</span>{(draft.type === "reply" || draft.attachments.length > 0) && <span className="draft-row-meta">{draft.type === "reply" && <span>Reply</span>}{draft.attachments.length > 0 && <span><Paperclip size={12} />{draft.attachments.length}</span>}</span>}</span><time dateTime={draft.updatedAt}>{Number.isNaN(new Date(draft.updatedAt).getTime()) ? "" : new Date(draft.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></button>)}
      {list.hasMore && <div className="load-more"><Button variant="outline" onClick={() => void load(list.nextCursor)} disabled={loading || !list.nextCursor}>Load more drafts <ArrowDown size={14} /></Button></div>}
    </div>
  </section>;
}
