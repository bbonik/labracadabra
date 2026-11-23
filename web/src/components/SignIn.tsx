/** First screen for anyone who isn't signed in (AWS mode). Invitation-only: there is no sign-up. */
import { FileSearch, Languages, LockKeyhole } from "lucide-preact";

export function SignIn({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div class="signin">
      <div class="signin-card">
        <img class="logo hero" src="/logo.svg" alt="" />
        <h1 class="wordmark">
          <b>Lab</b>racadabra
        </h1>
        <p class="signin-tag">All your family's lab results, in one private place.</p>
        <ul class="signin-points">
          <li>
            <Languages size={16} strokeWidth={1.9} aria-hidden /> Any lab, any format, any language
          </li>
          <li>
            <FileSearch size={16} strokeWidth={1.9} aria-hidden /> Every value linked to its source page
          </li>
          <li>
            <LockKeyhole size={16} strokeWidth={1.9} aria-hidden /> Private: only you and the family you invite
          </li>
        </ul>
        <button class="primary signin-btn" onClick={onSignIn}>
          Sign in
        </button>
        <p class="signin-foot">By invitation only. Got an invitation email? Sign in with that address and the temporary password.</p>
      </div>
    </div>
  );
}
