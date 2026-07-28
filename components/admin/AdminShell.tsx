"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AGENTS } from "@/lib/ai/agent-meta";
import { ChatPane } from "@/components/chat/ChatPane";
import { SurfaceSwitcher } from "@/components/SurfaceSwitcher";
import { KnowledgePanel } from "@/components/admin/KnowledgePanel";

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
  created_at: string;
};

type AdminView = "chat" | "knowledge";

const adminAgents = AGENTS.filter((a) => a.adminVisible);

export function AdminShell() {
  const [view, setView] = useState<AdminView>("chat");
  const [agentId, setAgentId] = useState("ceo");
  const [profile, setProfile] = useState<ProfileResponse["profile"] | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [answers, setAnswers] = useState<string[]>(["", "", "", "", ""]);
  const [savingAnswers, setSavingAnswers] = useState(false);
  const [onboardingSummary, setOnboardingSummary] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [profileRes, pendingRes] = await Promise.all([
      fetch("/api/profile").then((r) => r.json() as Promise<ProfileResponse>),
      fetch("/api/pending?status=open").then(
        (r) => r.json() as Promise<{ items: PendingItem[] }>,
      ),
    ]);
    setProfile(profileRes.profile);
    setMissing(profileRes.missing ?? []);
    setPending(pendingRes.items ?? []);
  }, []);

  useEffect(() => {
    // Defer initial fetch so setState is not synchronous inside the effect body.
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 0);
    const id = window.setInterval(() => void refresh(), 15000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(id);
    };
  }, [refresh]);

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

  async function resolvePending(id: string, status: "answered" | "dismissed") {
    await fetch("/api/pending", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    await refresh();
  }

  const questions = profile?.onboarding_questions ?? [];
  const showOnboarding =
    profile &&
    (profile.onboarding_state === "questions_asked" ||
      (questions.length === 5 && profile.onboarding_state !== "complete"));

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <SurfaceSwitcher current="admin" />
        <div className="brand-block">
          <p className="eyebrow">Owner / training</p>
          <h1>Admin</h1>
          <p className="muted">Default agent: CEO · no auth yet</p>
        </div>

        <nav className="admin-view-switch" aria-label="Admin sections">
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
        </nav>

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
              <h2>Pending questions ({pending.length})</h2>
              {pending.length === 0 ? (
                <p className="muted">Inbox clear.</p>
              ) : (
                <ul className="pending-list">
                  {pending.map((item) => (
                    <li key={item.id}>
                      <p className="pending-q">{item.question}</p>
                      <p className="pending-meta">{item.source}</p>
                      <div className="pending-actions">
                        <button
                          type="button"
                          onClick={() => void resolvePending(item.id, "answered")}
                        >
                          Mark answered
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => void resolvePending(item.id, "dismissed")}
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
        ) : (
          <section className="panel">
            <h2>Knowledge</h2>
            <p className="muted">
              Review what is vectorized, add files with a description, or delete stale
              sources. Chat stays available on the other tab.
            </p>
          </section>
        )}

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
        <header className="main-header">
          <div>
            <p className="eyebrow">
              {view === "chat" ? "Chatting with" : "Owner library"}
            </p>
            <h2>
              {view === "chat"
                ? (adminAgents.find((a) => a.id === agentId)?.label ?? agentId)
                : "Profile / Knowledge"}
            </h2>
          </div>
          <Link className="surface-jump" href="/">
            ← Public site
          </Link>
        </header>

        {view === "chat" ? (
          <ChatPane
            surface="admin"
            agentId={agentId}
            placeholder="Ask the CEO or switch agents…"
            emptyHint="Upload a CV to start onboarding, or talk with the CEO about your next moves."
          />
        ) : (
          <KnowledgePanel />
        )}
      </main>
    </div>
  );
}
