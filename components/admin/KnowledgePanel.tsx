"use client";

import { useCallback, useEffect, useState } from "react";

type StructuredProfile = Record<string, unknown>;

type ProfilePayload = {
  full_name: string | null;
  headline: string | null;
  public_bio: string | null;
  structured: StructuredProfile;
  onboarding_state: string;
  onboarding_questions: string[];
  onboarding_answers: string[];
};

type DocumentItem = {
  id: string;
  kind: string;
  filename: string;
  mime_type: string | null;
  description: string | null;
  chunk_count: number;
  vector_ids: string[];
  created_at: string;
};

const SECTION_LABELS: Record<string, string> = {
  skills: "Skills",
  roles: "Roles",
  industries: "Industries",
  locations: "Locations",
  languages: "Languages",
  highlights: "Highlights",
};

const HIDDEN_KEYS = new Set([
  "lastCvFilename",
  "lastCvIngestedAt",
]);

const KIND_OPTIONS = [
  { value: "cv", label: "CV / resume" },
  { value: "project", label: "Project" },
  { value: "note", label: "Note / writing" },
  { value: "other", label: "Other" },
] as const;

function formatValue(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map(String).filter((s) => s.trim().length > 0);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (typeof value === "object") {
    return [JSON.stringify(value, null, 2)];
  }
  return [];
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function KnowledgePanel() {
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [neon, setNeon] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<string>("other");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [profileRes, docsRes] = await Promise.all([
        fetch("/api/profile").then((r) => r.json()),
        fetch("/api/documents").then((r) => r.json()),
      ]);
      setProfile(profileRes.profile ?? null);
      setNeon(Boolean(docsRes.neon ?? profileRes.neon));
      setDocuments(docsRes.documents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load knowledge");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setUploadMsg("Choose a file to upload.");
      return;
    }
    setUploading(true);
    setUploadMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      form.append("description", description);
      // Onboarding Q&A lives on the Chat tab; Knowledge is library-only.
      form.append("onboarding", "false");
      const res = await fetch("/api/ingest", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setUploadMsg(
        `Ingested “${file.name}”` +
          ` (${data.chunkCount} chunks` +
          (data.upserted ? `, ${data.upserted} vectors` : "") +
          `).`,
      );
      setFile(null);
      setDescription("");
      await refresh();
    } catch (err) {
      setUploadMsg(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(id: string, filename: string) {
    if (!window.confirm(`Delete “${filename}” and its vectors from RAG?`)) {
      return;
    }
    setDeletingId(id);
    try {
      const res = await fetch(`/api/documents?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  const structured = profile?.structured ?? {};
  const knownEntries = Object.entries(SECTION_LABELS)
    .map(([key, label]) => ({
      key,
      label,
      values: formatValue(structured[key]),
    }))
    .filter((s) => s.values.length > 0);

  const otherEntries = Object.entries(structured)
    .filter(([key]) => !SECTION_LABELS[key] && !HIDDEN_KEYS.has(key))
    .map(([key, value]) => ({
      key,
      label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
      values: formatValue(value),
    }))
    .filter((s) => s.values.length > 0);

  const totalVectors = documents.reduce(
    (sum, d) => sum + (d.vector_ids?.length || d.chunk_count || 0),
    0,
  );

  return (
    <div className="knowledge-panel">
      <div className="knowledge-stats">
        <div>
          <p className="eyebrow">Indexed</p>
          <p className="knowledge-stat-value">{documents.length}</p>
          <p className="muted">files</p>
        </div>
        <div>
          <p className="eyebrow">Chunks / vectors</p>
          <p className="knowledge-stat-value">{totalVectors}</p>
          <p className="muted">linked in Upstash</p>
        </div>
        <div>
          <p className="eyebrow">Onboarding</p>
          <p className="knowledge-stat-value knowledge-stat-text">
            {profile?.onboarding_state?.replace(/_/g, " ") ?? "—"}
          </p>
          <p className="muted">{neon ? "Neon connected" : "Neon missing"}</p>
        </div>
      </div>

      {loading ? <p className="muted">Loading profile…</p> : null}
      {error ? <p className="chat-error">{error}</p> : null}

      <section className="knowledge-section">
        <header className="knowledge-section-head">
          <h3>What the agent knows</h3>
          <p className="muted">
            Structured fields parsed from CVs and onboarding — readable, not a raw dump.
          </p>
        </header>

        <div className="profile-identity">
          <p className="eyebrow">Identity</p>
          <h4>{profile?.full_name || "Peter"}</h4>
          {profile?.headline ? (
            <p className="profile-headline">{profile.headline}</p>
          ) : null}
          {profile?.public_bio ? (
            <p className="profile-bio">{profile.public_bio}</p>
          ) : (
            <p className="muted">No public bio yet — upload a CV to seed one.</p>
          )}
        </div>

        {knownEntries.length === 0 && otherEntries.length === 0 ? (
          <p className="muted">
            No structured skills/roles yet. Upload a CV (kind: CV) from Chat or below.
          </p>
        ) : (
          <div className="knowledge-grid">
            {[...knownEntries, ...otherEntries].map((section) => (
              <article key={section.key} className="knowledge-card">
                <h4>{section.label}</h4>
                <ul>
                  {section.values.map((v, i) => (
                    <li key={`${section.key}-${i}`}>{v}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}

        {profile?.onboarding_questions?.length &&
        profile.onboarding_answers?.length ? (
          <div className="knowledge-card knowledge-qa">
            <h4>Onboarding answers</h4>
            <ul>
              {profile.onboarding_questions.map((q, i) => (
                <li key={i}>
                  <strong>{q}</strong>
                  <span>{profile.onboarding_answers[i] || "—"}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="knowledge-section">
        <header className="knowledge-section-head">
          <h3>Uploaded knowledge</h3>
          <p className="muted">
            Files parsed into Neon + embedded in Upstash. Delete removes both.
          </p>
        </header>

        {documents.length === 0 ? (
          <p className="muted">No uploads yet.</p>
        ) : (
          <ul className="doc-list">
            {documents.map((doc) => (
              <li key={doc.id} className="doc-item">
                <div className="doc-main">
                  <div className="doc-title-row">
                    <span className="doc-kind">{doc.kind}</span>
                    <strong>{doc.filename}</strong>
                  </div>
                  {doc.description ? (
                    <p className="doc-desc">{doc.description}</p>
                  ) : (
                    <p className="muted doc-desc">No description</p>
                  )}
                  <p className="doc-meta">
                    {formatDate(doc.created_at)} · {doc.chunk_count} chunks ·{" "}
                    {doc.vector_ids?.length ?? 0} vector ids
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost danger-btn"
                  disabled={deletingId === doc.id}
                  onClick={() => void onDelete(doc.id, doc.filename)}
                >
                  {deletingId === doc.id ? "Deleting…" : "Delete"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="knowledge-section">
        <header className="knowledge-section-head">
          <h3>Upload more</h3>
          <p className="muted">
            CV, project notes, writing — anything the agent should remember. Add a short
            description so retrieval knows why it matters.
          </p>
        </header>

        <form className="upload-form" onSubmit={(e) => void onUpload(e)}>
          <label className="upload-field">
            <span>Type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KIND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="upload-field">
            <span>Description</span>
            <textarea
              rows={3}
              placeholder="e.g. Side project from 2024 — shipping ops dashboard for a logistics client"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <label className="file-btn upload-file-btn">
            <input
              type="file"
              accept=".pdf,.txt,.md,text/plain,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? file.name : "Choose file (PDF, TXT, MD)"}
          </label>

          <button type="submit" disabled={uploading || !file}>
            {uploading ? "Ingesting…" : "Upload & vectorize"}
          </button>
          {uploadMsg ? <p className="panel-note">{uploadMsg}</p> : null}
        </form>
      </section>
    </div>
  );
}
