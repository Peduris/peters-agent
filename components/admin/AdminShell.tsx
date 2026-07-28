"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AGENTS } from "@/lib/ai/agent-meta";
import { ChatPane } from "@/components/chat/ChatPane";
import { KnowledgePanel } from "@/components/admin/KnowledgePanel";
import {
  ConversationsPanel,
  type ConversationsFilter,
} from "@/components/admin/ConversationsPanel";
import { ADMIN_CEO_SESSION_ID } from "@/lib/ai/session-ids";

type ProfileResponse = {
  profile: {
    onboarding_state: string;
    onboarding_questions: string[];
    public_bio: string | null;
    headline: string | null;
    full_name?: string | null;
    structured?: Record<string, unknown>;
  };
  neon: boolean;
  missing: string[];
};

type PendingItem = {
  id: string;
  source: string;
  question: string;
  context: string | null;
  status: string;
  visitor_session_id?: string | null;
  created_at: string;
};

type VisitorSessionItem = {
  id: string;
  label: string | null;
  preview: string | null;
  message_count: number;
  open_pending_count: number;
  interest_flag?: boolean;
  interest_score?: number;
  interest_reasons?: string[];
  needs_attention?: boolean;
  last_message_at: string | null;
  updated_at: string;
};

type AdminView = "chat" | "knowledge" | "conversations";

const adminAgents = AGENTS.filter((a) => a.adminVisible);

export function AdminShell() {
  const [view, setView] = useState<AdminView>("chat");
  const [conversationsFilter, setConversationsFilter] =
    useState<ConversationsFilter>("attention");
  const [agentId, setAgentId] = useState("ceo");
  const [profile, setProfile] = useState<ProfileResponse["profile"] | null>(
    null,
  );
  const [missing, setMissing] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [sessions, setSessions] = useState<VisitorSessionItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [sessionMessages, setSessionMessages] = useState<
    Array<{ id: string; role: string; content: string; created_at: string }>
  >([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [answers, setAnswers] = useState<string[]>(["", "", "", "", ""]);
  const [savingAnswers, setSavingAnswers] = useState(false);
  const [onboardingSummary, setOnboardingSummary] = useState<string | null>(
    null,
  );

  const refresh = useCallback(async () => {
    const [profileRes, pendingRes, sessionsRes] = await Promise.all([
      fetch("/api/profile").then((r) => r.json() as Promise<ProfileResponse>),
      fetch("/api/pending?status=open").then(
        (r) => r.json() as Promise<{ items: PendingItem[] }>,
      ),
      fetch("/api/sessions").then(
        (r) => r.json() as Promise<{ sessions: VisitorSessionItem[] }>,
      ),
    ]);
    setProfile(profileRes.profile);
    setMissing(profileRes.missing ?? []);
    setPending(pendingRes.items ?? []);
    setSessions(sessionsRes.sessions ?? []);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 0);
    const id = window.setInterval(() => void refresh(), 10000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(id);
    };
  }, [refresh]);

  async function openSession(id: string) {
    setSelectedSessionId(id);
    const res = await fetch(
      `/api/sessions?id=${encodeURIComponent(id)}&messages=1`,
    );
    const data = await res.json();
    setSessionMessages(
      (data.messages ?? []).map(
        (m: {
          id: string;
          role: string;
          content: string;
          created_at: string;
        }) => m,
      ),
    );
  }

  async function onUpload(file: File | null) {
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    setOnboardingSummary(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "cv");
      form.append("description", "Primary CV upload from admin chat sidebar");
      form.append("onboarding", "true");
      const res = await fetch("/api/ingest", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setUploadMsg(
        `CV ingested (${data.chunkCount} chunks` +
          (data.upserted ? `, ${data.upserted} vectors` : "") +
          `). Answer the 5 questions below.`,
      );
      setAnswers(["", "", "", "", ""]);
      await refresh();
    } catch (error) {
      setUploadMsg(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function submitOnboarding(e: React.FormEvent) {
    e.preventDefault();
    setSavingAnswers(true);
    setOnboardingSummary(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save answers");
      setOnboardingSummary(data.summary || "Onboarding complete.");
      await refresh();
    } catch (error) {
      setOnboardingSummary(
        error instanceof Error ? error.message : "Could not save answers",
      );
    } finally {
      setSavingAnswers(false);
    }
  }

  async function dismissPending(id: string) {
    await fetch("/api/pending", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "dismissed" }),
    });
    await refresh();
  }

  const questions = profile?.onboarding_questions ?? [];
  const showOnboarding =
    profile &&
    (profile.onboarding_state === "questions_asked" ||
      (questions.length === 5 && profile.onboarding_state !== "complete"));

  const attentionSessions = useMemo(
    () =>
      sessions.filter(
        (s) =>
          s.needs_attention ||
          s.open_pending_count > 0 ||
          Boolean(s.interest_flag),
      ),
    [sessions],
  );

  const listedSessions =
    view === "conversations" && conversationsFilter === "attention"
      ? attentionSessions
      : sessions;

  const headerTitle =
    view === "chat"
      ? (adminAgents.find((a) => a.id === agentId)?.label ?? agentId)
      : view === "knowledge"
        ? "Profile / Knowledge"
        : conversationsFilter === "attention"
          ? "Requiring attention"
          : "All Agent runs";

  const headerEyebrow =
    view === "chat"
      ? "Chatting with"
      : view === "knowledge"
        ? "Owner library"
        : "AI conversations";

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="brand-block">
          <p className="eyebrow">Owner / training</p>
          <h1>Admin</h1>
          <p className="muted">Default agent: CEO · no auth yet</p>
        </div>

        {view === "chat" ? (
          <>
            <nav className="agent-list" aria-label="Agents">
              {adminAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className={agentId === agent.id ? "active" : ""}
                  onClick={() => setAgentId(agent.id)}
                >
                  <span className="agent-label">{agent.label}</span>
                  <span className="agent-desc">{agent.description}</span>
                </button>
              ))}
            </nav>

            <section className="panel">
              <h2>Recent visitors ({sessions.length})</h2>
              <p className="muted panel-hint">
                Full inbox lives under AI conversations. Escalations still land
                in CEO chat.
              </p>
              {sessions.length === 0 ? (
                <p className="muted">No visitor sessions yet.</p>
              ) : (
                <ul className="session-list">
                  {sessions.slice(0, 8).map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className={
                          selectedSessionId === s.id
                            ? "session-item active"
                            : "session-item"
                        }
                        onClick={() => {
                          setView("conversations");
                          setConversationsFilter(
                            s.open_pending_count > 0 || s.interest_flag
                              ? "attention"
                              : "all",
                          );
                          void openSession(s.id);
                        }}
                      >
                        <span className="session-item-id">
                          {s.id.slice(0, 8)}…
                          {s.open_pending_count > 0
                            ? ` · ${s.open_pending_count} open`
                            : s.interest_flag
                              ? " · interesting"
                              : ""}
                        </span>
                        <span className="session-item-preview">
                          {s.preview || `${s.message_count} messages`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <h2>CV upload</h2>
              <p className="muted panel-hint">
                Seeds onboarding. Manage all files in Profile / Knowledge.
              </p>
              <label className="file-btn">
                <input
                  type="file"
                  accept=".pdf,.txt,.md,text/plain,application/pdf"
                  disabled={uploading}
                  onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
                />
                {uploading ? "Uploading…" : "Upload CV"}
              </label>
              {uploadMsg ? <p className="panel-note">{uploadMsg}</p> : null}
            </section>

            {showOnboarding ? (
              <section className="panel">
                <h2>Onboarding (5 questions)</h2>
                <form onSubmit={submitOnboarding} className="onboarding-form">
                  {questions.map((q, i) => (
                    <label key={i} className="qa">
                      <span>
                        {i + 1}. {q}
                      </span>
                      <textarea
                        rows={2}
                        value={answers[i] ?? ""}
                        onChange={(e) => {
                          const next = [...answers];
                          next[i] = e.target.value;
                          setAnswers(next);
                        }}
                        required
                      />
                    </label>
                  ))}
                  <button type="submit" disabled={savingAnswers}>
                    {savingAnswers ? "Saving…" : "Save answers"}
                  </button>
                </form>
                {onboardingSummary ? (
                  <p className="panel-note">{onboardingSummary}</p>
                ) : null}
              </section>
            ) : null}

            <section className="panel">
              <h2>Secondary inbox ({pending.length})</h2>
              <p className="muted panel-hint">
                Primary path: answer in the CEO chat when it asks “What should I
                tell them?”
              </p>
              {pending.length === 0 ? (
                <p className="muted">Inbox clear.</p>
              ) : (
                <ul className="pending-list">
                  {pending.map((item) => (
                    <li key={item.id}>
                      <p className="pending-q">{item.question}</p>
                      <p className="pending-meta">
                        {item.source}
                        {item.visitor_session_id
                          ? ` · ${item.visitor_session_id.slice(0, 8)}…`
                          : ""}
                      </p>
                      <div className="pending-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setAgentId("ceo");
                          }}
                        >
                          Open CEO chat
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => void dismissPending(item.id)}
                        >
                          Dismiss
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}

        {view === "conversations" ? (
          <section className="panel">
            <h2>Session context</h2>
            <p className="muted panel-hint">
              Open a thread in the main pane. Use CEO chat when a visitor is
              waiting on your reply.
            </p>
            {attentionSessions.length > 0 ? (
              <p className="panel-note">
                {attentionSessions.length} conversation
                {attentionSessions.length === 1 ? "" : "s"} need attention.
              </p>
            ) : (
              <p className="muted">Attention queue is clear.</p>
            )}
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setView("chat");
                setAgentId("ceo");
              }}
            >
              Open CEO chat
            </button>
          </section>
        ) : null}

        {view === "knowledge" ? (
          <section className="panel">
            <h2>Knowledge</h2>
            <p className="muted">
              Review what is vectorized, add files with a description, or delete
              stale sources. Chat stays available from the top menu.
            </p>
          </section>
        ) : null}

        {missing.length > 0 ? (
          <section className="panel warn">
            <h2>Missing env</h2>
            <ul>
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </aside>

      <main className="admin-main">
        <header className="main-header admin-main-header">
          <div className="admin-header-title">
            <p className="eyebrow">{headerEyebrow}</p>
            <h2>{headerTitle}</h2>
          </div>
          <div className="admin-header-actions">
            <nav className="admin-top-nav" aria-label="Admin sections">
              <button
                type="button"
                className={view === "chat" ? "active" : ""}
                onClick={() => setView("chat")}
              >
                Chat
              </button>
              <button
                type="button"
                className={view === "knowledge" ? "active" : ""}
                onClick={() => setView("knowledge")}
              >
                Profile / Knowledge
              </button>
              <button
                type="button"
                className={view === "conversations" ? "active" : ""}
                onClick={() => setView("conversations")}
              >
                AI conversations
                {attentionSessions.length > 0 ? (
                  <span className="nav-badge">{attentionSessions.length}</span>
                ) : null}
              </button>
            </nav>
            <Link className="surface-jump" href="/">
              ← Public site
            </Link>
          </div>
        </header>

        {view === "chat" ? (
          <ChatPane
            surface="admin"
            agentId={agentId}
            historySessionId={
              agentId === "ceo" ? ADMIN_CEO_SESSION_ID : null
            }
            resetKey={agentId}
            placeholder={
              agentId === "ceo"
                ? "Answer visitor escalations here, or ask the CEO…"
                : "Message this agent…"
            }
            emptyHint={
              agentId === "ceo"
                ? "Visitor unknowns appear here as CEO questions. Reply in chat to store knowledge and message that visitor."
                : "Switch to CEO to handle visitor escalations."
            }
          />
        ) : null}

        {view === "knowledge" ? <KnowledgePanel /> : null}

        {view === "conversations" ? (
          <ConversationsPanel
            filter={conversationsFilter}
            onFilterChange={(f) => {
              setConversationsFilter(f);
              setSelectedSessionId(null);
              setSessionMessages([]);
            }}
            sessions={listedSessions}
            selectedSessionId={selectedSessionId}
            sessionMessages={sessionMessages}
            onOpenSession={(id) => void openSession(id)}
            onOpenCeoChat={() => {
              setView("chat");
              setAgentId("ceo");
            }}
            attentionCount={attentionSessions.length}
          />
        ) : null}
      </main>
    </div>
  );
}
