// ============================================
// FEEDBACK — Super-admin panel (SUPERUSUARIO)
// ============================================
// FASE 1: the moderation trash ("Papelera"). Lists everything the admin
// soft-deleted (from moderation_log) and restores it via admin_restore.
// FASE 2 will add the Usuarios / Notificaciones / Moderación / Q&A tabs.
//
// SECURITY: this page is reachable only via the isAdmin-gated SUPERUSUARIO
// button, and re-checks currentUserIsAdmin() on entry. But that's cosmetic
// — moderation_log RLS returns ZERO rows to non-admins, and admin_restore
// re-checks is_admin() server-side. A non-admin who forces the route sees
// an empty trash and can restore nothing.

import { ICONS, formatRelative } from '../data/mock-data.js';
import { router } from '../router.js';
import { showToast } from '../utils/toast.js';
import { sanitize } from '../utils/helpers.js';
import { listModerationLog, adminRestore } from '../data/api.js';
import { currentUserIsAdmin } from '../utils/admin-moderation.js';

const TYPE_LABEL = {
  post: 'Publicación',
  comment: 'Comentario',
  chat_message: 'Mensaje de chat',
  question: 'Pregunta',
  party: 'Fiesta',
};

export function renderAdmin(container) {
  // Defensive gate. The button + route are admin-only, but never trust the
  // client — server RLS/RPCs are the real guard.
  if (!currentUserIsAdmin()) { router.navigate('wall'); return; }

  container.innerHTML = `
    <div class="page" id="admin-page">
      <button class="back-btn" id="admin-back">${ICONS.back}<span>Perfil</span></button>

      <div class="page-title" style="display:flex;align-items:center;gap:8px;">
        <span style="width:22px;height:22px;display:inline-flex;color:#dc2626;">${ICONS.shield}</span>
        Panel · Super-admin
      </div>
      <p style="color:var(--text-secondary);font-size:var(--text-sm);line-height:1.5;margin:4px 0 var(--space-md);">
        Papelera de moderación: restaura lo que hayas eliminado. Las demás herramientas
        (usuarios, notificaciones, moderación y Q&amp;A) llegan en la Fase 2.
      </p>

      <div class="tab-bar" style="margin-bottom:var(--space-md);">
        <button class="tab-item active" type="button">🗑️ Papelera</button>
      </div>

      <div id="admin-trash">
        <div class="empty-state">
          <div class="spinner" style="margin:0 auto var(--space-md);"></div>
          <p class="empty-state-text">Cargando papelera…</p>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#admin-back').addEventListener('click', () => router.navigate('profile'));

  loadTrash(container.querySelector('#admin-trash'));
}

async function loadTrash(trashEl) {
  let entries = [];
  try {
    entries = await listModerationLog();
  } catch (err) {
    console.warn('[admin] moderation_log fetch failed', err);
    trashEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <p class="empty-state-text">No se pudo cargar la papelera.</p>
      </div>`;
    return;
  }

  const deletions = entries.filter(e => e.action === 'soft_delete');
  if (deletions.length === 0) {
    trashEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🗑️</div>
        <h3 class="empty-state-title">Papelera vacía</h3>
        <p class="empty-state-text">Lo que elimines como admin aparecerá aquí para restaurarlo.</p>
      </div>`;
    return;
  }

  trashEl.innerHTML = deletions.map(renderTrashItem).join('');

  // One delegated handler for all restore buttons (survives re-render
  // because we reassign onclick each load).
  trashEl.onclick = async (e) => {
    const btn = e.target.closest('[data-restore-log]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await adminRestore(btn.dataset.restoreLog);
      showToast('Restaurado ✓', 'success');
      loadTrash(trashEl);
    } catch (err) {
      btn.disabled = false;
      const msg = String(err?.message || '');
      showToast(
        msg.includes('already_restored') ? 'Ya estaba restaurado.' : 'No se pudo restaurar.',
        'error',
      );
      console.warn('[admin] restore failed', err);
    }
  };
}

function previewOf(entry) {
  const b = entry.beforeState || {};
  let t = '';
  switch (entry.targetType) {
    case 'post':
    case 'comment':
    case 'chat_message': t = b.content; break;
    case 'question':     t = b.question; break;
    case 'party':        t = b.name; break;
    default:             t = '';
  }
  t = (t || '').toString().trim();
  if (!t) return '(sin vista previa)';
  return t.length > 140 ? t.slice(0, 140) + '…' : t;
}

function renderTrashItem(entry) {
  const label = TYPE_LABEL[entry.targetType] || entry.targetType;
  const restored = !!entry.restoredAt;
  return `
    <div style="background:var(--surface,rgba(255,255,255,0.04));border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:var(--space-md);margin-bottom:var(--space-sm);${restored ? 'opacity:0.55;' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
        <span class="badge">${sanitize(label)}</span>
        <span style="font-size:var(--text-xs);color:var(--text-tertiary);">${formatRelative(entry.createdAt)}</span>
      </div>
      <div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.4;margin-bottom:6px;">${sanitize(previewOf(entry))}</div>
      ${entry.reason ? `<div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-bottom:8px;">Motivo: ${sanitize(entry.reason)}</div>` : ''}
      ${restored
        ? `<span style="font-size:var(--text-xs);color:#16a34a;font-weight:600;">Restaurado ✓</span>`
        : `<button class="btn btn-secondary btn-sm" data-restore-log="${entry.id}">Restaurar</button>`}
    </div>
  `;
}
