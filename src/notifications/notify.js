// =====================================================================
// FEEDBACK / PartyRate — high-level push notification helpers
// =====================================================================
// Thin wrappers around the `send-push` Edge Function. Each helper sends
// ONLY a type + the ids needed to identify the resource — the actual
// title/body/url is built server-side from the caller's JWT, so the
// `fromUsername` argument exposed in the signatures (per the spec) is
// ignored on the wire. We keep it in the function signature so callers
// can pass it as documentation without breaking the contract.
//
// All helpers are fire-and-forget: they swallow errors so a push failure
// never blocks the in-app flow (the like/comment still happens).
// =====================================================================

import { supabase } from '../data/supabase.js';

async function callSendPush(payload) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return; // not signed in → nothing to do

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization:  `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[notify] send-push HTTP', res.status, text);
    }
  } catch (err) {
    // Network failure / Edge Function down / CORS edge case — never let
    // it propagate up, the user action that triggered it already
    // succeeded locally + via the realtime channel.
    console.warn('[notify] send-push threw', err);
  }
}

// ---------------- Public API ----------------

export function notifyNewLike(toUserId, _fromUsername, postId) {
  return callSendPush({ type: 'like', toUserId, postId });
}

export function notifyNewComment(toUserId, _fromUsername, postId) {
  return callSendPush({ type: 'comment', toUserId, postId });
}

export function notifyNewFollower(toUserId, _fromUsername) {
  return callSendPush({ type: 'follow', toUserId });
}

export function notifyNewChatMessage(toUserId, _fromUsername, roomId) {
  return callSendPush({ type: 'chat', toUserId, roomId });
}

// Fired by the target (= the person answering) toward the asker, so
// the asker gets a push when their anonymous question is answered.
// `questionId` is forwarded so the Edge Function can compose a deep
// link straight to the answer.
export function notifyQuestionAnswered(toUserId, _fromUsername, questionId) {
  return callSendPush({ type: 'question-answered', toUserId, questionId });
}

// Fired by a guest confirming attendance toward the party's promoter,
// so the promoter sees a real-time push every time someone RSVPs.
// `partyId` lets the Edge Function build a link straight to the
// promoter's party detail page.
export function notifyPartyAttendance(toUserId, _fromUsername, partyId) {
  return callSendPush({ type: 'party-attendance', toUserId, partyId });
}
