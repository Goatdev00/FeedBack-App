// =====================================================================
// FEEDBACK — Shared admin (super-admin) moderation UI helpers
// =====================================================================
// Logic shared by every inline-moderation surface (posts, comments, chat,
// parties). Presentation (the button HTML) stays at each call site so it
// matches that surface's existing markup; only the GATE and the CONFIRM
// MODAL live here.
//
// SECURITY: currentUserIsAdmin() is a COSMETIC gate — it decides whether a
// control renders, nothing more. The real authorization is server-side:
// every admin_* RPC is SECURITY DEFINER and re-checks public.is_admin()
// (migration 0033), and profiles.is_admin is frozen against client
// self-update (migration 0030). A tampered DevTools session that forces
// the button to appear still gets 'forbidden' from the RPC.
// =====================================================================

import { store } from '../data/mock-data.js';
import { createModal } from './dom.js';
import { showToast } from './toast.js';

/** True when the logged-in user is the super-admin (FeedBack). */
export function currentUserIsAdmin() {
  return !!store.getState().currentUser?.isAdmin;
}

/**
 * Open a confirm-with-reason modal for an admin soft-delete.
 *
 * @param {object}  opts
 * @param {string}  opts.title         Modal heading.
 * @param {string}  opts.message       Safe HTML/text body (sanitize at the call site).
 * @param {string} [opts.confirmLabel] Confirm button label.
 * @param {(reason: string|null) => Promise<void>} opts.onConfirm
 *        Performs the RPC + any local refresh. MUST throw on failure; the
 *        modal stays open and shows an error toast. On success the modal
 *        closes automatically.
 */
export function confirmAdminDelete({
  title,
  message,
  confirmLabel = 'Eliminar',
  errorLabel = 'No se pudo completar la acción.',
  durationField = false,
  onConfirm,
}) {
  const overlay = createModal(`
    <div class="modal" style="max-width:420px;">
      <div class="modal-handle"></div>
      <div style="text-align:center;padding:var(--space-sm) 0;">
        <div style="font-size:2.25rem;margin-bottom:var(--space-xs);">🛡️</div>
        <h2 style="font-family:var(--font-display);font-size:var(--text-lg);font-weight:700;margin-bottom:var(--space-sm);">${title}</h2>
        <p style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.5;margin-bottom:var(--space-md);">${message}</p>
      </div>
      <div class="input-group mb-md">
        <label class="input-label">Motivo (opcional, queda en el registro)</label>
        <input type="text" class="input" id="admin-del-reason" maxlength="200" placeholder="Ej: spam, contenido ofensivo…" />
      </div>
      ${durationField ? `
        <div class="input-group mb-md">
          <label class="input-label">Duración en días (vacío = permanente)</label>
          <input type="number" class="input" id="admin-del-days" min="1" placeholder="Permanente" />
        </div>
      ` : ''}
      <div style="display:flex;gap:var(--space-sm);">
        <button type="button" class="btn btn-secondary" id="admin-del-cancel" style="flex:1;">Cancelar</button>
        <button type="button" class="btn" id="admin-del-confirm" style="flex:1;background:#dc2626;color:white;border:none;">${confirmLabel}</button>
      </div>
    </div>
  `);

  overlay.querySelector('#admin-del-cancel').addEventListener('click', () => overlay.close());

  const confirmBtn = overlay.querySelector('#admin-del-confirm');
  confirmBtn.addEventListener('click', async () => {
    const reason = overlay.querySelector('#admin-del-reason').value.trim() || null;
    let days = null;
    if (durationField) {
      const n = parseInt(overlay.querySelector('#admin-del-days').value, 10);
      days = Number.isFinite(n) && n > 0 ? n : null;
    }
    confirmBtn.disabled = true;
    try {
      await onConfirm(reason, days);
      overlay.close();
    } catch (err) {
      confirmBtn.disabled = false;
      // Map known server reasons to friendly text; fall back to the
      // action-specific errorLabel. (Edge-function errors are unwrapped to
      // their JSON `error` by the api.js invoke wrappers, so these match.)
      const msg = String(err?.message || '');
      let text = errorLabel;
      if (msg.includes('forbidden')) text = 'No tienes permiso (solo admin).';
      else if (msg.includes('cannot_target_admin')) text = 'No puedes moderar a otro admin.';
      else if (msg.includes('cannot_target_self')) text = 'No puedes aplicarte esto a ti mismo.';
      else if (msg.includes('already_restored')) text = 'Ya estaba restaurado.';
      else if (msg.includes('invalid_uuid')) text = 'Destinatario inválido.';
      else if (msg.includes('no_channel')) text = 'Elegí al menos un canal (push o correo).';
      else if (msg.includes('recipient_resolution_failed')) text = 'No se pudieron resolver los destinatarios.';
      // Non-2xx with no JSON body (or the generic invoke message) usually
      // means the Edge Function isn't deployed / is named differently.
      else if (msg.includes('non-2xx') || msg === 'edge_error') text = `${errorLabel} ¿La función está desplegada en Supabase con el nombre correcto?`;
      else if (msg && msg !== 'supabase_not_configured') text = `${errorLabel} (${msg})`;
      showToast(text, 'error', 6000);
      console.warn('[admin-action]', err);
    }
  });
}
