"use client";
// PRO｜个人资料 inside the member shell.
import { useMember } from "../../../member-context";
import { ProfileForm } from "../../../account-settings";
import { TopBar } from "../../../ui";

export default function Profile() {
  const member = useMember();
  return (
    <main className="app-main">
      <TopBar title="个人资料" back="/me" />
      <ProfileForm onSaved={() => void member.refresh()} />
    </main>
  );
}
