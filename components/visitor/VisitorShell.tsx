"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChatPane } from "@/components/chat/ChatPane";
import { DEFAULT_PUBLIC_BIO, visitorGreeting } from "@/lib/ai/copy";

import { VISITOR_SESSION_STORAGE_KEY } from "@/lib/ai/session-ids";

const SESSION_KEY = VISITOR_SESSION_STORAGE_KEY;

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function VisitorShell() {
  const [bio, setBio] = useState(DEFAULT_PUBLIC_BIO);
  const [headline, setHeadline] = useState("Peter's Agent");
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const id = getOrCreateSessionId();
    setSessionId(id);
    void fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {
      /* session create is best-effort */
    });

    void fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data?.profile?.public_bio) setBio(data.profile.public_bio);
        if (data?.profile?.headline) setHeadline(data.profile.headline);
      })
      .catch(() => {
        /* keep defaults */
      });
  }, []);

  function startNewSession() {
    const id = crypto.randomUUID();
    try {
      window.localStorage.setItem(SESSION_KEY, id);
    } catch {
      /* ignore */
    }
    setSessionId(id);
    void fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  return (
    <div className="visitor-shell">
      <aside className="visitor-sidebar">
        <div className="brand-hero">
          <p className="brand-mark">Peter&apos;s Agent</p>
          <p className="brand-sub">{headline}</p>
        </div>
        <div className="bio-block">
          <h2>About</h2>
          <p>{bio}</p>
        </div>
        <p className="greeting-fixed">{visitorGreeting()}</p>
        <button type="button" className="ghost session-new" onClick={startNewSession}>
          New chat session
        </button>
        {sessionId ? (
          <p className="session-id muted">Session {sessionId.slice(0, 8)}…</p>
        ) : null}
      </aside>
      <main className="visitor-main">
        <header className="main-header">
          <div>
            <p className="eyebrow">Visitor chat</p>
            <h2>Public Face</h2>
          </div>
          <Link className="surface-jump" href="/admin">
            Open Admin →
          </Link>
        </header>
        {sessionId ? (
          <ChatPane
            surface="visitor"
            agentId="public-face"
            visitorSessionId={sessionId}
            pollDeliveries
            resetKey={sessionId}
            placeholder="Ask Peter's Agent…"
            emptyHint={visitorGreeting()}
          />
        ) : (
          <p className="chat-empty">Starting your session…</p>
        )}
      </main>
    </div>
  );
}
