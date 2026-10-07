"use client";
// Legacy /settings entry. With ?setup=company it is AUTH.PROFILE_FIRST (older accounts
// without a work WhatsApp); otherwise it shows PRO + SEC for old bookmarks.
import { useEffect, useState } from "react";
import { ProfileForm, SecurityPanel } from "../account-settings";
import { TopBar } from "../ui";

export default function Settings() {
  const [setup, setSetup] = useState(null);
  useEffect(() => { setSetup(new URLSearchParams(window.location.search).get("setup") === "company"); }, []);
  if (setup === null) return <main className="app-main no-nav" />;
  return (
    <main className="app-main no-nav">
      {setup ? <TopBar title="补齐个人资料" /> : <TopBar title="个人设置" back="/me" />}
      <div className="stack">
        <ProfileForm setup={setup} />
        {!setup && <><h2 className="section-title" style={{ marginTop: 8 }}>账号安全</h2><SecurityPanel /></>}
      </div>
    </main>
  );
}
