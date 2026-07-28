"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

type Props = {
  surface: "admin" | "visitor";
  agentId: string;
  placeholder?: string;
  emptyHint?: string;
  resetKey?: string;
  visitorSessionId?: string | null;
  /** When true, poll for orchestrator-delivered replies into this thread. */
  pollDeliveries?: boolean;
};

export function ChatPane({
  surface,
  agentId,
  placeholder = "Message…",
  emptyHint,
  resetKey,
  visitorSessionId,
  pollDeliveries = false,
}: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const deliveredIds = useRef<Set<string>>(new Set());

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: {
          surface,
          agentId,
          ...(visitorSessionId ? { visitorSessionId } : {}),
        },
      }),
    [surface, agentId, visitorSessionId],
  );

  const { messages, sendMessage, status, setMessages, error, clearError } =
    useChat({
      id: `${surface}-${agentId}-${resetKey ?? visitorSessionId ?? "default"}`,
      transport,
    });

  useEffect(() => {
    setMessages([]);
    clearError?.();
    deliveredIds.current = new Set();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, resetKey, visitorSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (!pollDeliveries || !visitorSessionId) return;

    let cancelled = false;

    async function pullReplies() {
      try {
        const res = await fetch(
          `/api/sessions?id=${encodeURIComponent(visitorSessionId!)}&replies=1&markDelivered=1`,
        );
        const data = await res.json();
        const replies = (data.replies ?? []) as Array<{
          id: string;
          publicReply: string;
        }>;
        if (cancelled || replies.length === 0) return;

        const fresh = replies.filter(
          (r) => r.publicReply && !deliveredIds.current.has(r.id),
        );
        if (fresh.length === 0) return;

        for (const r of fresh) deliveredIds.current.add(r.id);

        setMessages((prev) => [
          ...prev,
          ...fresh.map((r) => ({
            id: `delivery-${r.id}`,
            role: "assistant" as const,
            parts: [{ type: "text" as const, text: r.publicReply }],
          })),
        ]);
      } catch {
        /* ignore poll errors */
      }
    }

    void pullReplies();
    const timer = window.setInterval(() => void pullReplies(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollDeliveries, visitorSessionId, setMessages]);

  const busy = status === "submitted" || status === "streaming";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    await sendMessage({ text });
  }

  return (
    <div className="chat-pane">
      <div className="chat-scroll" aria-live="polite">
        {messages.length === 0 && emptyHint ? (
          <p className="chat-empty">{emptyHint}</p>
        ) : null}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`bubble ${message.role === "user" ? "user" : "assistant"}`}
          >
            <span className="bubble-role">
              {message.role === "user"
                ? "You"
                : surface === "visitor"
                  ? "Peter's Agent"
                  : agentId}
            </span>
            <div className="bubble-text">{messageText(message)}</div>
          </article>
        ))}
        {busy ? <p className="chat-status">Thinking…</p> : null}
        {error ? (
          <p className="chat-error" role="alert">
            {error.message}
          </p>
        ) : null}
        <div ref={bottomRef} />
      </div>
      <form className="chat-form" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor={`chat-input-${surface}-${agentId}`}>
          Message
        </label>
        <textarea
          id={`chat-input-${surface}-${agentId}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSubmit(e);
            }
          }}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
