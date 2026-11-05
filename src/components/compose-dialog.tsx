"use client";

import { useEffect, useId, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, Check, CircleAlert, FileText, LoaderCircle, LockKeyhole, Paperclip, Save, Send, X } from "lucide-react";
import type { DraftReview, MailDraft } from "../lib/mail-types";
import { draftFields, draftInput, draftRequest, DraftRequestError, emptyDraftFields, type DraftFields } from "./draft-api";
import { Button } from "./ui/button";

export interface ComposeSession { key: string; draftId?: string; reply?: { threadId: string; replyToEmailId: string; subject: string }; }
type ComposeProps = { senderAddress: string; session: ComposeSession; onClose: () => void; onSaved: () => void; onSent: () => void; onLogin: () => void; onCheckSent: () => void; };

export function ComposeDialog({ senderAddress, session, onClose, onSaved, onSent, onLogin, onCheckSent }: ComposeProps) {
  const [fields, setFields] = useState<DraftFields>(emptyDraftFields);
  const [baseline, setBaseline] = useState(JSON.stringify(emptyDraftFields));
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [loading, setLoading] = useState(Boolean(session.draftId || session.reply));
  const [initialError, setInitialError] = useState(false);
  const [loadRetry, setLoadRetry] = useState(0);
  const [busy, setBusy] = useState<"save" | "review" | "send" | null>(null);
  const [review, setReview] = useState<DraftReview | null>(null);
  const [expired, setExpired] = useState(false);
  const [sent, setSent] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [showAdditionalRecipients, setShowAdditionalRecipients] = useState(false);
  const action = useRef(false);
  const createAttempt = useRef<{ signature: string; requestId: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const dirty = JSON.stringify(fields) !== baseline;
  const needsPlainSave = draft?.hasHtml === true;

  useEffect(() => {
    if (!session.draftId && !session.reply) return;
    const controller = new AbortController();
    setLoading(true); setInitialError(false); setError("");
    const pending = session.draftId
      ? draftRequest<{ draft: MailDraft }>(`/api/drafts/${encodeURIComponent(session.draftId)}`, { signal: controller.signal })
      : draftRequest<{ draft: MailDraft }>("/api/drafts", { method: "POST", signal: controller.signal, body: JSON.stringify({ ...session.reply, requestId: session.key }) });
    pending.then(result => {
      if (controller.signal.aborted) return;
      const values = draftFields(result.draft);
      setDraft(result.draft); setFields(values); setBaseline(JSON.stringify(values)); setSavedAt(result.draft.updatedAt);
      setShowAdditionalRecipients(Boolean(values.cc || values.bcc));
      if (session.reply) onSaved();
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setInitialError(true); setError(cause instanceof Error ? cause.message : "This draft couldn’t open.");
      if (cause instanceof DraftRequestError && cause.status === 401) onLogin();
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // A stable session key also makes a repeated reply creation idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.key, loadRetry]);

  useEffect(() => {
    if (!dirty || sent) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, sent]);
  useEffect(() => {
    if (!review) return;
    setExpired(false);
    const remaining = new Date(review.expiresAt).getTime() - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) { setExpired(true); return; }
    const timer = window.setTimeout(() => setExpired(true), remaining);
    return () => window.clearTimeout(timer);
  }, [review]);
  useEffect(() => { if (review || sent) heading.current?.focus(); }, [review, sent]);

  function report(cause: unknown) {
    setError(cause instanceof Error ? cause.message : "This request couldn’t finish. Your editor is still here.");
    if (cause instanceof DraftRequestError && cause.status === 401) onLogin();
  }
  function requestClose() {
    if (action.current || loading) return;
    if (dirty && !sent) setConfirmClose(true); else onClose();
  }
  function edit(field: keyof DraftFields, value: string) { setFields(previous => ({ ...previous, [field]: value })); setReview(null); setError(""); setSavedAt(null); }
  async function save(closeAfter = false) {
    if (action.current || loading || initialError || sent || uncertain) return;
    action.current = true; setBusy("save"); setError("");
    const payload = draftInput(fields);
    try {
      let result: { draft: MailDraft };
      if (draft) result = await draftRequest(`/api/drafts/${encodeURIComponent(draft.id)}`, { method: "PATCH", body: JSON.stringify({ ...payload, expectedUpdatedAt: draft.updatedAt }) });
      else {
        const signature = JSON.stringify(payload);
        if (!createAttempt.current || createAttempt.current.signature !== signature) createAttempt.current = { signature, requestId: crypto.randomUUID() };
        result = await draftRequest("/api/drafts", { method: "POST", body: JSON.stringify({ ...payload, requestId: createAttempt.current.requestId }) });
      }
      const values = draftFields(result.draft);
      setDraft(result.draft); setFields(values); setBaseline(JSON.stringify(values)); setSavedAt(result.draft.updatedAt); setReview(null); onSaved();
      if (closeAfter) onClose();
    } catch (cause) { report(cause); }
    finally { action.current = false; setBusy(null); }
  }
  async function prepareReview() {
    if (action.current || !draft || dirty || needsPlainSave || sent || uncertain) return;
    action.current = true; setBusy("review"); setError("");
    try {
      const result = await draftRequest<DraftReview>(`/api/drafts/${encodeURIComponent(draft.id)}/review`, { method: "POST", body: "{}" });
      // Display the exact canonical snapshot bound to the server's review token.
      const values = draftFields(result.draft);
      setDraft(result.draft); setFields(values); setBaseline(JSON.stringify(values)); setSavedAt(result.draft.updatedAt); setReview(result); setExpired(false);
    } catch (cause) { report(cause); }
    finally { action.current = false; setBusy(null); }
  }
  async function sendReviewed() {
    if (action.current || !review || sent || uncertain || expired) return;
    const expires = new Date(review.expiresAt).getTime();
    if (!Number.isFinite(expires) || expires <= Date.now()) { setExpired(true); return; }
    action.current = true; setBusy("send"); setError("");
    try {
      const result = await draftRequest<{ emailId: string; sent: boolean }>(`/api/drafts/${encodeURIComponent(review.draft.id)}/send`, { method: "POST", body: JSON.stringify({ reviewToken: review.reviewToken }) });
      if (result.sent !== true || !result.emailId) throw new Error("Delivery couldn’t be confirmed.");
      setSent(true); setReview(null); onSent();
    } catch (cause) {
      if (!(cause instanceof DraftRequestError) || cause.status >= 500) {
        setUncertain(true); setError("Delivery couldn’t be confirmed. Check Sent before trying again. This message will not be retried automatically.");
      } else { setReview(null); report(cause); }
    } finally { action.current = false; setBusy(null); }
  }

  const canReview = Boolean(draft) && !dirty && !needsPlainSave;
  const title = sent ? "Message sent" : review ? "Review email" : session.reply || draft?.type === "reply" ? "Reply" : "New message";
  return <>
    <Dialog.Root open onOpenChange={open => { if (!open) requestClose(); }}><Dialog.Portal><Dialog.Overlay className="compose-overlay" /><Dialog.Content className="compose-dialog" onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus(); }} onEscapeKeyDown={event => { event.preventDefault(); requestClose(); }} onPointerDownOutside={event => { event.preventDefault(); requestClose(); }}>
      <header className="compose-header"><Dialog.Title ref={heading} tabIndex={-1}>{title}</Dialog.Title><Button variant="ghost" size="icon" onClick={requestClose} aria-label="Close message editor" disabled={Boolean(busy) || loading}><X size={21} /></Button></header>
      <Dialog.Description className="sr-only">Write from the configured sender, save a draft, then review before sending.</Dialog.Description>
      {sent ? <div className="compose-success"><span><Check size={30} /></span><h3>Sent</h3><div className="success-actions"><Button variant="outline" onClick={onClose}>Done</Button><Button onClick={onCheckSent}>View sent <ArrowRight size={16} /></Button></div></div>
      : loading ? <div className="compose-loading" role="status"><LoaderCircle size={25} className="refreshing" /><p>{session.reply ? "Opening your reply draft…" : "Opening your saved draft…"}</p></div>
      : initialError ? <div className="compose-loading"><CircleAlert size={25} /><p role="alert">{error}</p><Button variant="outline" onClick={() => setLoadRetry(value => value + 1)}>Try opening again</Button><Button variant="ghost" onClick={onClose}>Close</Button></div>
      : <>
        <div className="compose-scroll">
          <div className="compose-from"><span>From</span><strong>{senderAddress}</strong><LockKeyhole size={13} aria-label="Sender is fixed by server configuration" /></div>
          {error && <div className="compose-error" role="alert"><CircleAlert size={17} /><p>{error}</p></div>}
          {review ? <div className="send-review">
            <div className="review-warning"><CircleAlert size={18} /><p>Check the recipients and message. Sending can’t be undone.</p></div>
            <dl className="review-fields"><dt>To</dt><dd>{review.draft.to.join(", ") || "None"}</dd>{review.draft.cc.length > 0 && <><dt>Cc</dt><dd>{review.draft.cc.join(", ")}</dd></>}{review.draft.bcc.length > 0 && <><dt>Bcc</dt><dd>{review.draft.bcc.join(", ")}</dd></>}<dt>Subject</dt><dd>{review.draft.subject || "(No subject)"}</dd></dl>
            <div className="review-body"><pre>{review.draft.text || "(No message text)"}</pre></div>
            <DraftAttachments draft={review.draft} review />
            <p className="review-expiry" role="status">{expired ? "Review expired. Review again to send." : `Review expires at ${new Date(review.expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`}</p>
          </div> : <>
            {needsPlainSave && <div className="compose-notice"><FileText size={17} /><p>Saving replaces this draft’s formatting with plain text. Check the message before saving.</p></div>}
            <fieldset className="compose-fields" disabled={Boolean(busy) || uncertain}>
              <div className="compose-field"><label htmlFor={`${id}-to`}>To</label><input id={`${id}-to`} value={fields.to} onChange={event => edit("to", event.target.value)} inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby={`${id}-recipients-help`} placeholder="Email addresses" />{!showAdditionalRecipients && <Button variant="ghost" size="sm" className="recipients-toggle" aria-expanded={false} aria-controls={`${id}-extra-recipients`} onClick={() => { setShowAdditionalRecipients(true); window.requestAnimationFrame(() => document.getElementById(`${id}-cc`)?.focus()); }}>Cc / Bcc</Button>}</div>
              <div id={`${id}-extra-recipients`} hidden={!showAdditionalRecipients}>{(["cc", "bcc"] as const).map(field => <div className="compose-field" key={field}><label htmlFor={`${id}-${field}`}>{field === "cc" ? "Cc" : "Bcc"}</label><input id={`${id}-${field}`} value={fields[field]} onChange={event => edit(field, event.target.value)} inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby={`${id}-recipients-help`} placeholder="Optional" /></div>)}</div>
              <p id={`${id}-recipients-help`} className="sr-only">Separate email addresses with commas.</p>
              <div className="compose-field"><label htmlFor={`${id}-subject`}>Subject</label><input id={`${id}-subject`} value={fields.subject} onChange={event => edit("subject", event.target.value)} placeholder="Add a subject" /></div>
              <label className="sr-only" htmlFor={`${id}-text`}>Message body, plain text</label><textarea id={`${id}-text`} className="compose-body" value={fields.text} onChange={event => edit("text", event.target.value)} placeholder="Write your message…" />
            </fieldset>
            {draft && <DraftAttachments draft={draft} />}
          </>}
        </div>
        <footer className="compose-footer"><div className="compose-save-status" role="status">{busy === "save" ? <><LoaderCircle size={14} className="refreshing" />Saving…</> : dirty ? <><span className="unsaved-dot" />Unsaved changes</> : draft ? <><Check size={14} />Draft saved</> : "New draft"}{savedAt && !dirty && <time dateTime={savedAt}> {new Date(savedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time>}{!review && <span className="plain-text-status">Plain text</span>}</div>
          <div className="compose-actions">{uncertain ? <Button variant="outline" onClick={onCheckSent}>Check Sent <ArrowLeft size={16} /></Button> : review ? <><Button variant="outline" onClick={() => { setReview(null); setError(""); }} disabled={Boolean(busy)}><ArrowLeft size={16} />Edit message</Button>{expired ? <Button onClick={prepareReview} disabled={Boolean(busy)}>Review again</Button> : <Button onClick={sendReviewed} disabled={Boolean(busy) || expired}><Send size={16} />{busy === "send" ? "Sending…" : `Send from ${senderAddress}`}</Button>}</> : <><Button variant={canReview ? "outline" : "default"} onClick={() => void save()} disabled={Boolean(busy) || (!dirty && Boolean(draft) && !needsPlainSave)}><Save size={16} />{busy === "save" ? "Saving…" : "Save draft"}</Button><Button variant={canReview ? "default" : "outline"} onClick={prepareReview} disabled={Boolean(busy) || !canReview} title={!canReview ? "Save your draft to review it" : undefined}><Send size={16} />{busy === "review" ? "Preparing…" : "Review email"}</Button></>}</div>
        </footer>
      </>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={confirmClose} onOpenChange={setConfirmClose}><Dialog.Portal><Dialog.Overlay className="compose-confirm-overlay" /><Dialog.Content className="compose-confirm" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => event.preventDefault()}><Dialog.Title>Save your changes?</Dialog.Title><Dialog.Description>{draft ? "Discarding keeps your last saved version." : "Unsaved text will be lost if you discard it."}</Dialog.Description>{error && <p className="compose-error" role="alert">{error}</p>}<div><Button onClick={() => void save(true)} disabled={Boolean(busy)}><Save size={16} />{busy ? "Saving…" : "Save & close"}</Button><Button variant="outline" onClick={() => setConfirmClose(false)} disabled={Boolean(busy)}>Keep editing</Button><Button variant="ghost" className="discard-button" onClick={onClose} disabled={Boolean(busy)}>Discard changes</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}

function DraftAttachments({ draft, review = false }: { draft: MailDraft; review?: boolean }) {
  if (draft.attachments.length === 0) return null;
  return <section className="draft-attachments" aria-label="Draft attachments"><h3><Paperclip size={15} />Attachments <span>{draft.attachments.length}</span></h3><ul>{draft.attachments.map(attachment => <li key={attachment.id}><Paperclip size={15} /><span>{attachment.filename || "Untitled attachment"}</span>{attachment.size !== undefined && <small>{attachment.size.toLocaleString()} bytes</small>}</li>)}</ul><p>{review ? "Included when you send." : "Saved with this draft."}</p></section>;
}
