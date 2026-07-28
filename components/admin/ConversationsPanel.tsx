"use client";

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

type SessionMessage = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

export type ConversationsFilter = "all" | "attention";

type Props = {
  filter: ConversationsFilter;
  onFilterChange: (filter: ConversationsFilter) => void;
  sessions: VisitorSessionItem[];
  selectedSessionId: string | null;
  sessionMessages: SessionMessage[];
  onOpenSession: (id: string) => void;
  onOpenCeoChat: () => void;
  attentionCount: number;
};

function formatWhen(iso: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function attentionBadges(s: VisitorSessionItem) {
  const badges: string[] = [];
  if (s.open_pending_count > 0) {
    badges.push(
      s.open_pending_count === 1
        ? "Needs reply"
        : `${s.open_pending_count} open`,
    );
  }
  if (s.interest_flag) {
    const reason = s.interest_reasons?.[0];
    badges.push(reason ? `Interesting · ${reason}` : "Interesting");
  }
  return badges;
}

export function ConversationsPanel({
  filter,
  onFilterChange,
  sessions,
  selectedSessionId,
  sessionMessages,
  onOpenSession,
  onOpenCeoChat,
  attentionCount,
}: Props) {
  const selected = sessions.find((s) => s.id === selectedSessionId) ?? null;

  return (
    <div className="conversations-panel">
      <div className="conversations-toolbar">
        <nav className="conversations-subnav" aria-label="Conversation filters">
          <button
            type="button"
            className={filter === "all" ? "active" : ""}
            onClick={() => onFilterChange("all")}
          >
            All Agent runs
          </button>
          <button
            type="button"
            className={filter === "attention" ? "active" : ""}
            onClick={() => onFilterChange("attention")}
          >
            Requiring my attention
            {attentionCount > 0 ? (
              <span className="nav-badge">{attentionCount}</span>
            ) : null}
          </button>
        </nav>
        <p className="muted conversations-hint">
          {filter === "all"
            ? "Every public visitor thread."
            : "Open escalations plus high-signal outreach (interview, hiring, recruiter)."}
        </p>
      </div>

      <div className="conversations-layout">
        <section className="conversations-list" aria-label="Conversations">
          {sessions.length === 0 ? (
            <p className="muted conversations-empty">
              {filter === "attention"
                ? "Nothing needs your attention right now."
                : "No visitor conversations yet."}
            </p>
          ) : (
            <ul>
              {sessions.map((s) => {
                const badges = attentionBadges(s);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={
                        selectedSessionId === s.id
                          ? "conversation-row active"
                          : "conversation-row"
                      }
                      onClick={() => onOpenSession(s.id)}
                    >
                      <span className="conversation-row-top">
                        <span className="conversation-id">
                          {s.label?.trim() || `${s.id.slice(0, 8)}…`}
                        </span>
                        <span className="conversation-when">
                          {formatWhen(s.last_message_at || s.updated_at)}
                        </span>
                      </span>
                      <span className="conversation-preview">
                        {s.preview || `${s.message_count} messages`}
                      </span>
                      {badges.length > 0 ? (
                        <span className="conversation-badges">
                          {badges.map((b) => (
                            <span key={b} className="conversation-badge">
                              {b}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="conversation-detail" aria-label="Thread detail">
          {!selectedSessionId ? (
            <p className="muted conversations-empty">
              Select a conversation to read the thread.
            </p>
          ) : (
            <>
              <header className="conversation-detail-header">
                <div>
                  <p className="eyebrow">Visitor thread</p>
                  <h3>
                    {selected?.label?.trim() ||
                      `${selectedSessionId.slice(0, 8)}…`}
                  </h3>
                  <p className="muted">
                    {selected?.message_count ?? sessionMessages.length} messages
                    {selected?.open_pending_count
                      ? ` · ${selected.open_pending_count} awaiting reply`
                      : ""}
                  </p>
                </div>
                {selected && selected.open_pending_count > 0 ? (
                  <button
                    type="button"
                    className="surface-jump"
                    onClick={onOpenCeoChat}
                  >
                    Answer in CEO chat →
                  </button>
                ) : null}
              </header>
              {sessionMessages.length === 0 ? (
                <p className="muted">No messages in this thread yet.</p>
              ) : (
                <ul className="conversation-msgs">
                  {sessionMessages.map((m) => (
                    <li
                      key={m.id}
                      className={
                        m.role === "user"
                          ? "conversation-msg user"
                          : "conversation-msg assistant"
                      }
                    >
                      <span className="bubble-role">
                        {m.role === "user" ? "Visitor" : "Agent"}
                      </span>
                      <p className="bubble-text">{m.content}</p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
