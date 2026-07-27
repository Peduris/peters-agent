"use client";

import { useEffect, useState } from "react";
import { ChatPane } from "@/components/chat/ChatPane";
import { SurfaceSwitcher } from "@/components/SurfaceSwitcher";
import { DEFAULT_PUBLIC_BIO, visitorGreeting } from "@/lib/ai/copy";

export function VisitorShell() {
  const [bio, setBio] = useState(DEFAULT_PUBLIC_BIO);
  const [headline, setHeadline] = useState("Peter's Agent");

  useEffect(() => {
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

  return (
    <div className="visitor-shell">
      <aside className="visitor-sidebar">
        <SurfaceSwitcher current="visitor" />
        <div className="brand-hero">
          <p className="brand-mark">Peter&apos;s Agent</p>
          <p className="brand-sub">{headline}</p>
        </div>
        <div className="bio-block">
          <h2>About</h2>
          <p>{bio}</p>
        </div>
        <p className="greeting-fixed">{visitorGreeting()}</p>
      </aside>
      <main className="visitor-main">
        <ChatPane
          surface="visitor"
          agentId="public-face"
          placeholder="Ask Peter's Agent…"
          emptyHint={visitorGreeting()}
        />
      </main>
    </div>
  );
}
