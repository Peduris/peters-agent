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
};

export function ChatPane({
  surface,
  agentId,
  placeholder = "Message…",
  emptyHint,
  resetKey,
}: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { surface, agentId },
      }),
    [surface, agentId],
  );

  const { messages, sendMessage, status, setMessages, error, clearError } =
    useChat({
      id: `${surface}-${agentId}-${resetKey ?? "default"}`,
      transport,
    });

  useEffect(() => {
    setMessages([]);
    clearError?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, resetKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

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
              {message.role === "user" ? "You" : surface === "visitor" ? "Peter's Agent" : agentId}
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
