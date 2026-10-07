import MemberProvider from "../member-context";

// Daily member pages share one mounted provider: company scope, current quote and G.NAVBAR.
export default function MemberLayout({ children }) {
  return <MemberProvider>{children}</MemberProvider>;
}
