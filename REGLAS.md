# REGLAS — Sistema de puntos de FEEDBACK

Este documento describe el sistema de gamificación de la plataforma: cómo se ganan/pierden puntos, los eventos que los disparan, los límites, validaciones y la arquitectura sugerida para escalar la funcionalidad.

> **Nota sobre el origen de las reglas.** Las constantes principales viven en [`src/data/mock-data.js`](src/data/mock-data.js) bajo el objeto `POINTS_RULES`. Algunas reglas adicionales (puntos de bienvenida, multiplicadores, edge cases de cooldown, anti‑fraude) **no existen aún en código**: están marcadas como **(Inferido)** y representan una propuesta consistente con la lógica observada en la UI, los toasts y los mensajes que ya muestra la app. Se incluyen aquí para servir de blueprint cuando se implementen.

---

## 1. Resumen ejecutivo

| Evento                                              | Puntos | Límite diario | Implementado |
|-----------------------------------------------------|:------:|:-------------:|:------------:|
| Bienvenida al completar onboarding                  | +50    | 1 (vida)      | ✅           |
| Asistir a una fiesta (`toggleAttendance`)           | +20    | 3             | ✅ (sin tope diario actual) |
| Primera publicación útil en una fiesta              | +15    | 1 por fiesta  | ✅           |
| Calificar una fiesta el domingo                     | +10    | 5             | ✅           |
| Conexión mutua (los dos se siguen)                  | +10    | 1 por par     | ✅           |
| Responder pregunta en perfil                        | +5     | 10            | ✅           |
| Publicación destacada (featured)                    | +10    | 1             | ⏳ Inferido  |
| Reporte validado por usuarios                       | +10    | (sin tope)    | ✅ — ver §11 |
| Cancelar asistencia confirmada                      | −20    | —             | ⏳ Inferido  |
| Publicación duplicada / spam                        | 0      | —             | ✅ (no suma) |
| Publicación reportada como abuso                    | −10    | —             | ⏳ Inferido  |

---

## 2. Estructura de datos relevante

### 2.1 Usuario (`MOCK_USERS`)

```js
{
  id, name, username, role,           // role ∈ {raver, dj, promotor}
  city, bio, avatar,
  points,                             // saldo actual (entero, ≥ 0)
  followers, following,
  badges: [],                         // legacy — sistema de medallas retirado
  partiesAttended: ['p1','p2'],
  postsToday,                         // contador legacy; ver §6.1
  premium,
  social: { instagram, tiktok, twitter },
  theme: 'dark' | 'light'
}
```

### 2.2 Catálogo de reglas (`POINTS_RULES`)

`src/data/mock-data.js`:

```js
export const POINTS_RULES = {
  attendParty:     { points: 20, label: 'Asistir a una fiesta',          dailyLimit: 3 },
  firstPost:       { points: 15, label: 'Primera publicación útil',      dailyLimit: 1 },
  ratePartySunday: { points: 10, label: 'Calificar fiesta el domingo',   dailyLimit: 5 },
  answerQuestion:  { points:  5, label: 'Responder pregunta en perfil',  dailyLimit: 10 },
  featuredPost:    { points: 10, label: 'Publicación destacada',         dailyLimit: 1 },
  validatedReport: { points: 10, label: 'Reporte validado por usuarios', dailyLimit: 3 },
};
```

> **Importante (deuda técnica).** Hoy el método `store.addPoints(amount, reason)` recibe el monto **literal** desde la página que dispara el evento; no consulta `POINTS_RULES`. Esto crea inconsistencias si el catálogo cambia. La arquitectura propuesta en §8 centraliza la concesión de puntos.

### 2.3 Medallas

> El sistema de medallas (`BADGES`) fue retirado del producto. La pestaña **Puntos** del perfil ahora muestra el balance acumulado y la guía de cómo ganar más puntos. El campo `user.badges` se conserva en los mocks por compatibilidad pero la UI ya no lo lee. Si en el futuro se reintroducen medallas/logros, conviene derivarlas del *ledger* propuesto en §8 en lugar de un array estático.

---

## 3. Cómo se ganan puntos (eventos implementados)

### 3.1 Bienvenida — onboarding completo

- **Archivo:** [`src/pages/onboarding.js`](src/pages/onboarding.js) → `finishOnboarding()`.
- Al crear la cuenta se inicializa el usuario con `points: 50` y se muestra el toast “+50 pts de bienvenida”.
- **Edge case:** si el usuario reinicia la app (botón “Reiniciar datos”) o vuelve a hacer onboarding, los 50 pts se vuelven a otorgar. Es el comportamiento esperado del modo demo.

### 3.2 Asistencia a una fiesta — +20 pts

- **Archivo:** [`src/data/mock-data.js`](src/data/mock-data.js) → `Store.toggleAttendance(partyId)`.
- Se suma **solo** al marcar asistencia (no al cancelarla).
- **Trigger UI:** botones “Asistiré” en `parties.js` y `party-detail.js`.
- **Toast:** `Asistencia confirmada +20 pts ⚡`.

### 3.3 Primera publicación en una fiesta — +15 pts

- **Archivo:** `Store.addPost(post)` detecta `userPostsInParty.length === 1` y otorga 15 pts.
- **Toast:** se muestra explícitamente desde `create-post.js`:
  `showPointsToast(15, 'Publicación en fiesta')`.
- **Restricciones aplicadas:**
  - Hard cap de 5 publicaciones diarias por usuario (`Store.canUserPost`).
  - Detección de duplicado idéntico en la misma fiesta: la publicación se rechaza con toast `Publicación duplicada. No suma puntos.`.

### 3.4 Calificar fiestas el domingo — +10 pts por fiesta

- **Archivo:** [`src/pages/sunday-rating.js`](src/pages/sunday-rating.js) → `next-btn` click.
- Requisito mínimo: **3 categorías calificadas** por fiesta antes de poder avanzar y obtener los puntos. Hay 7 categorías disponibles (`SUNDAY_CATEGORIES`).
- El usuario solo ve este flujo:
  - Automáticamente vía modal el primer ingreso del domingo (`main.js` → `showSundayPrompt`).
  - Manualmente desde el banner naranja en `parties.js` o la notificación del nav.
- Las fiestas elegibles son las que el usuario asistió esa semana (mezcla de `user.partiesAttended` y `party.attendees`).

### 3.5 Conexión mutua (los dos se siguen) — +10 pts a ambas partes

- **Archivo:** [`src/data/mock-data.js`](src/data/mock-data.js) → `Store.toggleFollow(targetId)`.
- El follow unilateral **no** otorga puntos. La regla se activa solo cuando se cierra la reciprocidad:
  1. A sigue a B → sin puntos (mutuality = false).
  2. B sigue a A → mutuality = true → **+10 pts a A y +10 pts a B**.
- La clave del par se **normaliza** (`[a, b].sort().join('<>')`) y se guarda en `state.awardedFollows`. Como es order-independent, no importa quién cerró la reciprocidad: el par cuenta como uno solo.
- **Toast:** `+10 pts ⚡ — Conectados con <nombre> 🤝` (solo en el momento exacto de la reciprocidad).
- **Unfollow no resta puntos** (REGLAS §4): si A unfollow a B, ambos conservan los +10 ganados. El edge follower→following se borra pero `awardedFollows` no.
- **Anti-farm:** si después se vuelven a seguir mutuamente, no se otorgan puntos extra (la clave ya está en `awardedFollows`).
- **Retorno de `toggleFollow`:** `{ changed, nowFollowing, awarded, mutual }` para que la UI distinga entre "siguiendo (uno solo)" y "conexión cerrada".

### 3.6 Responder pregunta en perfil — +5 pts

- **Archivo:** `Store.answerQuestion(questionId, answer)`.
- Sólo se otorgan puntos la primera vez que `q.answer` pasa de `null` a un string.

### 3.7 Publicación destacada — +10 pts (Inferido)

- Marcado en el catálogo pero **no disparado** en código.
- Propuesta: un job periódico (o trigger por umbral de likes) que marque `post.featured = true` y emita un evento `featuredPost`.

### 3.8 Reporte validado — +10 pts

- **Implementado** vía la función `report_post()` (Postgres, `SECURITY DEFINER`).
- Cuando una publicación acumula **10 reportes** de usuarios distintos, se oculta automáticamente y los **10 reportantes reciben +10 pts cada uno** en la misma transacción.
- El detalle completo del flujo (categorías, esquema, RLS, banner del autor, notificación, realtime, safeguards y limitaciones conocidas) está documentado en **§11**.
- **Nota:** la columna "Límite diario" del catálogo (`POINTS_RULES.validatedReport.dailyLimit = 3`) todavía **no se aplica** del lado del servidor. Está documentado como pendiente en §11.11.

---

## 4. Cómo se pierden puntos

> Hoy la plataforma **no resta puntos**. Las siguientes reglas son propuestas para mantener la economía sana.

| Regla                                  | Penalización | Justificación                                                  |
|----------------------------------------|:------------:|----------------------------------------------------------------|
| Cancelar asistencia tras confirmarla   | −20          | Refleja “devolver” los puntos otorgados al confirmar.          |
| Publicación reportada por ≥3 usuarios  | −10          | Combate spam y abusos. Acompañar con cooldown de 24 h.         |
| Pregunta abusiva eliminada por usuario | −2           | Castigo leve a quien envía la pregunta anónima problemática.   |
| Fiesta duplicada aprobada              | −5           | Castiga sugerencias deshonestas.                               |

---

## 5. Multiplicadores (Inferido)

Propuesta de bonos que **no existen aún** en código pero son consistentes con la narrativa de la app:

- **Multiplicador de racha** (`active` badge): 1.10× sobre todos los puntos si el usuario fue activo ≥ 4 semanas seguidas.
- **Bono Premium**: usuarios con `premium: true` reciben 1.25× en `answerQuestion` y `firstPost`.
- **Bono primer reportero en fiesta**: 1.5× sobre el primer `firstPost` de la noche en cada fiesta para incentivar reportes en tiempo real.
- **Domingo doble**: si el usuario califica **todas** las fiestas a las que asistió en la semana → +20 pts extra de bono.

Estos multiplicadores se aplicarían **antes** de cualquier penalización y nunca convertirían un evento positivo en negativo.

---

## 6. Validaciones, cooldowns y edge cases

### 6.1 Tope de publicaciones diarias

- Límite duro: **5 publicaciones por día** por usuario.
- Implementado en `Store.getUserPostsToday` y `Store.canUserPost`.
- La UI desactiva el FAB y muestra toast cuando se supera (`wall.js` y `create-post.js`).
- ⚠️ El campo `user.postsToday` existe pero **no se mantiene actualizado** — la lógica usa el cálculo derivado sobre `state.posts`. Se recomienda eliminar `postsToday` para evitar confusión.

### 6.2 Detección de duplicados

- **Posts:** misma `partyId` + mismo `content` exacto del mismo usuario → bloqueado.
- **Fiestas (sugerir / crear):** `Store.detectDuplicate(name)` normaliza minúsculas y elimina no‑alfanuméricos; rechaza si hay coincidencia exacta o si una contiene a la otra.

### 6.3 Domingos

- `isSunday` se evalúa **una sola vez** al importar `mock-data.js`. Si la pestaña queda abierta y cruza la medianoche del domingo, la flag no se refresca hasta recargar.
- El modal de domingo se muestra a lo sumo una vez por día por sesión (`sessionStorage` key `sunday_${YYYY-MM-DD}`).

### 6.4 Expiración de publicaciones

- Cada publicación tiene `expiresAt = createdAt + 7 días` y se elimina al cargar el estado (`Store.cleanExpiredPosts`).
- **Edge case:** si una publicación expira mientras la pestaña está abierta, no se limpia hasta el siguiente reload.

### 6.5 Toggles que ya consumen recursos

- `toggleLike`, `toggleFollow`, `toggleAttendance` son idempotentes a nivel de estado pero `toggleAttendance` **otorga puntos cada vez** que el usuario marca asistencia. Si confirma → cancela → confirma se repiten los +20 pts. Esto es un bug menor: ver §7.

### 6.6 Cooldowns sugeridos (Inferido)

| Evento                              | Cooldown propuesto                |
|-------------------------------------|-----------------------------------|
| `attendParty` (misma fiesta)        | 1 vez por fiesta (lifetime)       |
| `firstPost` (misma fiesta)          | 1 vez por fiesta (ya implementado)|
| `answerQuestion` (mismo `targetUserId`) | 10 min entre respuestas       |
| `validatedReport` (mismo reporte)   | 24 h                              |

---

## 7. Riesgos conocidos / bugs detectados durante la auditoría

1. **Asistencia re-otorgable.** `toggleAttendance` suma 20 pts cada vez que el usuario re‑marca asistencia, sin chequear historial. **Fix:** mantener un set `state.pointsLedger.attendParty[partyId]` por usuario y verificar antes de sumar.
2. **`postsToday` en `users` está obsoleto.** Nadie lo actualiza tras el seed. Mantenerlo sólo en derivado.
3. **Sin tope diario real para `attendParty`.** Aunque el catálogo dice `dailyLimit: 3`, en código no hay enforcement.
4. **Catálogo desacoplado del código.** Las páginas pasan literales (`addPoints(20, 'Asistir a fiesta')`) en lugar de leer de `POINTS_RULES`. Cualquier cambio en el catálogo requiere editar varias páginas.

---

## 8. Arquitectura sugerida para escalar

```
              ┌────────────────────────────┐
              │   POINTS_RULES (catálogo)  │
              │  src/data/points-rules.js  │
              └────────────┬───────────────┘
                           │
              ┌────────────▼───────────────┐
              │   PointsEngine             │
              │  src/data/points-engine.js │
              │                            │
              │  award(ruleId, ctx) {      │
              │   - lee POINTS_RULES       │
              │   - valida dailyLimit      │
              │   - aplica multiplicadores │
              │   - registra en ledger     │
              │   - emite toast + notify   │
              │  }                         │
              └────────────┬───────────────┘
                           │
            ┌──────────────┼─────────────────┐
            ▼              ▼                 ▼
       wall.js       sunday-rating.js   profile.js …
       toggleLike    rate party         answerQuestion
```

### 8.1 Catálogo único

Mover `POINTS_RULES` a `src/data/points-rules.js`, sin importar lógica de UI. Exportar:

```js
export const RULES = {
  ATTEND_PARTY:     { id: 'attendParty',     points: 20, dailyLimit: 3,  oncePer: 'party' },
  FIRST_POST:       { id: 'firstPost',       points: 15, dailyLimit: 1,  oncePer: 'party' },
  RATE_PARTY:       { id: 'ratePartySunday', points: 10, dailyLimit: 5,  windowDay: 0 /* sun */ },
  ANSWER_QUESTION:  { id: 'answerQuestion',  points:  5, dailyLimit: 10, cooldownSec: 600 },
  FEATURED_POST:    { id: 'featuredPost',    points: 10, dailyLimit: 1 },
  VALIDATED_REPORT: { id: 'validatedReport', points: 10, dailyLimit: 3, cooldownSec: 86400 },
};
```

### 8.2 Ledger (registro contable)

Persistir cada concesión:

```js
state.pointsLedger = [
  { id: 'l_xxx', userId, ruleId, amount, ctx: { partyId, postId }, at: ISO }
];
```

Esto permite:
- Auditar puntos (responder “¿por qué tengo X pts?”).
- Calcular `dailyLimit` con queries simples sobre el ledger.
- Soportar **reverse** (al cancelar asistencia: emitir entry negativo en lugar de mutar `points`).
- Calcular badges dinámicamente (`critic` = `ledger.filter(l => l.ruleId === 'ratePartySunday').length >= 10`).

### 8.3 Fórmula con multiplicadores

```js
function award(userId, ruleId, ctx) {
  const rule = RULES[ruleId];
  if (!rule) return 0;
  if (!passesValidations(userId, rule, ctx)) return 0;
  const base = rule.points;
  const multipliers = computeMultipliers(userId, rule, ctx);
  const final = Math.round(base * multipliers.reduce((a, m) => a * m, 1));
  appendToLedger(userId, ruleId, final, ctx);
  state.users[userId].points += final;
  notify();
  return final;
}
```

### 8.4 Validaciones cross-cutting

Centralizar:
- `dailyLimit`: `ledger.filter(l => l.userId && l.ruleId && sameDay(l.at, today)).length < rule.dailyLimit`.
- `oncePer: 'party'`: `ledger.some(l => l.userId && l.ruleId && l.ctx.partyId === ctx.partyId)`.
- `cooldownSec`: comparar contra el último entry.
- **Anti-spam**: detectar bursts (≥3 eventos del mismo `ruleId` en <5 s) y suspender otorgamiento temporalmente.

### 8.5 Sincronización con backend (cuando exista)

La economía de puntos debe vivir en servidor — el cliente sólo refleja. Sugerencias:
- Endpoints `POST /api/points/award` y `GET /api/points/ledger?userId=`.
- El servidor revalida `dailyLimit` y `cooldownSec` (el cliente nunca es la fuente de verdad).
- Push de cambios vía WebSocket / SSE para mantener el counter de la UI vivo.

---

## 9. Referencias rápidas en el código

- Definición de reglas: [`src/data/mock-data.js`](src/data/mock-data.js) — buscar `POINTS_RULES`.
- Concesión actual de puntos:
  - Asistencia: [`src/data/mock-data.js`](src/data/mock-data.js) — `toggleAttendance`.
  - Primera publicación: [`src/data/mock-data.js`](src/data/mock-data.js) — `addPost`.
  - Respuesta a pregunta: [`src/data/mock-data.js`](src/data/mock-data.js) — `answerQuestion`.
  - Domingo: [`src/pages/sunday-rating.js`](src/pages/sunday-rating.js).
  - Bienvenida: [`src/pages/onboarding.js`](src/pages/onboarding.js) — `finishOnboarding`.
- Toasts: [`src/utils/toast.js`](src/utils/toast.js) — `showPointsToast(points, reason)`.

---

## 10. Checklist para futuras features de gamificación

- [ ] Mover `POINTS_RULES` a un módulo dedicado.
- [ ] Introducir `state.pointsLedger` y migrar todas las páginas a `PointsEngine.award(...)`.
- [ ] Implementar reverso en `toggleAttendance` (cancelar → −20 pts si previamente otorgados).
- [ ] Si se reintroducen logros, calcularlos a partir del ledger (no de un array fijo).
- [ ] Aplicar `dailyLimit` real a `attendParty`.
- [ ] Auditoría de toasts: que el monto del toast coincida 1:1 con lo que escribió el ledger.
- [ ] Anti‑abuso básico: throttle de eventos repetidos.
- [ ] Reglas configurables por entorno (mock vs producción).
- [ ] Persistir `lastDailyResetAt` para limpiar contadores al cambiar de día sin reload.

---

## 11. Sistema de reportes a publicaciones (abuso / moderación)

Antes de la migración `0014` el botón de bandera en cada publicación era **placebo**: hacía un `showToast('Publicación reportada')` y nada más — sin tabla, sin contador, sin acción. Esta sección describe el sistema real implementado a partir de esa migración.

### 11.1 Resumen del flujo en una frase

> Cualquier usuario autenticado puede reportar una publicación ajena eligiendo un motivo de una lista cerrada; cuando **10 reportes** distintos se acumulan sobre el mismo post, el post se **oculta automáticamente** para todos los demás usuarios, el autor recibe una **notificación** y los **10 reportantes ganan +10 pts** cada uno.

### 11.2 Categorías de reporte

Definidas como enum Postgres `public.report_reason`. Son fijas (no se aceptan strings libres):

| ID enum            | Etiqueta visible            | Emoji |
|--------------------|-----------------------------|:-----:|
| `spam`             | Spam                        | 🚫    |
| `offensive`        | Ofensivo o discurso de odio | 😡    |
| `misinformation`   | Información falsa           | ❌    |
| `self_promotion`   | Autopromoción               | 📢    |
| `harassment`       | Acoso o intimidación        | ⚠️    |
| `other`            | Otro                        | 📁    |

Añadir más opciones en el futuro = `ALTER TYPE public.report_reason ADD VALUE 'nuevo_motivo'`.

### 11.3 Esquema de datos

**Tabla `public.post_reports`** — un registro por (publicación, reportante):

```sql
post_reports (
  post_id     uuid not null references posts(id) on delete cascade,
  reporter_id uuid not null references profiles(id) on delete cascade,
  reason      report_reason not null,
  created_at  timestamptz not null default now(),
  primary key (post_id, reporter_id)
)
```

La **PK compuesta `(post_id, reporter_id)`** es la garantía de "un reporte por usuario por post": un segundo reporte del mismo usuario sobre el mismo post se descarta vía `ON CONFLICT DO NOTHING` (idempotente, no es error).

**Columnas nuevas en `public.posts`:**

| Columna         | Tipo          | Significado |
|-----------------|---------------|-------------|
| `hidden_at`     | `timestamptz` | `NULL` = visible. Cuando se cruza el umbral, queda con el timestamp del momento del bloqueo. |
| `hidden_reason` | `text`        | Identificador semántico del por qué fue ocultado. Hoy solo `'reports_threshold'`; en el futuro puede haber `'admin_manual'`, `'spam_filter'`, etc. |

### 11.4 La función `report_post()` — único punto de escritura

Toda la lógica vive en `public.report_post(p_post_id, p_reason)` (`SECURITY DEFINER`). El cliente **no puede** escribir directamente en `post_reports` ni tocar `posts.hidden_at`: no hay políticas RLS de INSERT/UPDATE para esas operaciones desde el rol `authenticated`. La función:

1. Verifica que `auth.uid()` existe → si no, `raise exception 'not_authenticated'`.
2. Lee `posts.user_id` del post objetivo:
   - Si el post no existe → `raise exception 'post_not_found'`.
   - Si el autor es el propio reportante → `raise exception 'cannot_report_own_post'`.
3. Inserta `(post_id, reporter_id, reason)` con `ON CONFLICT DO NOTHING`.
4. Recuenta `count(*)` de reportes para ese post.
5. Si `count >= 10` **y** `posts.hidden_at IS NULL`:
   - Actualiza `posts SET hidden_at = now(), hidden_reason = 'reports_threshold'`.
   - El `IF FOUND` garantiza que la concesión de puntos ocurre **una sola vez**, aunque después lleguen más reportes.
   - Suma `+10` a `points` de **cada uno** de los reporters de ese post (los 10).
6. Devuelve `jsonb` `{ count, hidden, threshold }` para que el cliente muestre feedback al reportante.

```sql
return jsonb_build_object(
  'count', v_count,
  'hidden', v_was_hidden,
  'threshold', v_threshold
);
```

`grant execute … to authenticated`. Cualquier intento de escribir directamente en `post_reports` desde un cliente con JWT de `authenticated` es rechazado por la ausencia de política `INSERT`.

### 11.5 Umbral y consecuencias

| Métrica                   | Valor actual | Cambiarlo |
|---------------------------|:------------:|-----------|
| Reportes para auto-ocultar | **10**       | Variable `v_threshold` en `report_post()`. Cambiarlo en migración futura. |
| Puntos por reporte validado | **+10**     | `update profiles set points = points + 10` dentro de la función. Cambiarlo en migración futura. |
| Puntos al autor del post   | 0 (no hay penalización) | Pendiente — ver §11.11. |

Cuando un post se oculta:
- `posts.hidden_at = now()`.
- `posts.hidden_reason = 'reports_threshold'`.
- Cada reportante recibe `+10` en `profiles.points` en la misma transacción.

### 11.6 Privacidad y permisos (RLS)

| Tabla / acción                              | Política                                                                 |
|---------------------------------------------|--------------------------------------------------------------------------|
| `post_reports` SELECT                       | Solo el reportante ve **sus propias** filas (`reporter_id = auth.uid()`). |
| `post_reports` INSERT/UPDATE/DELETE          | **Sin política directa** — solo accesible vía `report_post()`.           |
| `posts` SELECT                              | `expires_at > now() AND (hidden_at IS NULL OR user_id = auth.uid())`.    |
| `posts.hidden_at` / `posts.hidden_reason` UPDATE | Solo `service_role` y la función `SECURITY DEFINER`.                  |

Consecuencia clave: **nadie puede saber quién reportó qué**. El conteo (10/10) se expone solo agregado, vía el `jsonb` que devuelve el RPC al propio reportante.

### 11.7 Experiencia del autor del post oculto

1. **En el muro** ([`src/pages/wall.js`](src/pages/wall.js) → `renderPostCard`): si `post.hiddenAt` está set **y** `userId === currentUser.id`, el card se renderiza con la clase `.post-card-hidden`. En lugar del contenido y acciones aparece el banner:

   ```
   🚫  Publicación oculta por reportes
       Tu publicación recibió 10 o más reportes y ya no es visible para otros usuarios.
   ```

2. **En notificaciones** ([`src/data/mock-data.js`](src/data/mock-data.js) → `getNotifications()`): se genera una notificación **derivada** del propio estado — iterar `state.posts`, filtrar las propias con `hiddenAt`, y emitir:

   ```js
   {
     id: `blocked:<postId>`,
     kind: 'blocked',
     system: true,
     systemIcon: '🚫',
     actor: null,
     time: hiddenAt,
     text: 'tu publicación fue ocultada por múltiples reportes: "<preview>"',
     navigate: { route: 'profile' }
   }
   ```

   No hay tabla `notifications` separada: la "señal" es `posts.hidden_at` y el cliente la presenta como notificación cada vez que entra a la página.

3. **En realtime**: la suscripción `UPDATE` sobre `public.posts` ([`src/data/api.js`](src/data/api.js)) detecta el cambio de `hidden_at` y refresca el muro en vivo si el autor está mirándolo cuando se cruza el umbral.

### 11.8 Experiencia del reportante

1. En el muro, el botón de bandera (`data-action="report-post"`) solo se muestra para posts **ajenos**. Posts propios no tienen botón (defensa cosmética; la función igual rechazaría con `cannot_report_own_post`).
2. Al pulsarlo se abre un modal con las 6 categorías (`showReportModal` en wall.js).
3. Al elegir una, el modal se cierra y se llama al RPC. El usuario ve un toast con el resultado:
   - **Aún no se alcanzó el umbral:** `Reporte registrado (3/10).`
   - **Se alcanzó con este reporte:** `Reporte registrado. La publicación fue ocultada (10 reportes).`
   - **Reporte sobre post propio:** `No puedes reportar tu propia publicación.`
   - **Post ya borrado:** `La publicación ya no existe.`
4. Si el reporte fue el décimo, en la misma transacción se suman `+10 pts` al reportante (y a los otros 9). El refresh de puntos se ve en la siguiente carga del perfil/encabezado.

### 11.9 Realtime

| Evento de Postgres                    | Quién lo escucha                | Qué hace                                                              |
|---------------------------------------|---------------------------------|-----------------------------------------------------------------------|
| `INSERT` en `post_reports`             | Realtime publicado (futuro dashboard de moderación). | Hoy no se consume del lado del usuario final. |
| `UPDATE` en `posts` (cambio de `hidden_at`) | `subscribeRealtime` en api.js. | Si el autor está en `/wall` cuando cruza el umbral, se hace `router.refreshCurrentRoute()` y el banner aparece sin reload. |

Para usuarios distintos del autor, el `UPDATE` ni siquiera les llega: RLS de SELECT filtra ya el row entero porque su nuevo estado (`hidden_at NOT NULL` AND `user_id != auth.uid()`) no satisface la política.

### 11.10 Validaciones y safeguards

| Riesgo                                          | Mitigación                                                                                 |
|-------------------------------------------------|--------------------------------------------------------------------------------------------|
| Reportes múltiples del mismo usuario sobre el mismo post | PK `(post_id, reporter_id)` + `ON CONFLICT DO NOTHING`.                                  |
| Reportarse a uno mismo                          | Chequeo `v_author = auth.uid()` antes del INSERT → `raise exception`.                       |
| Tampering con `hidden_at` desde el cliente      | Sin política `UPDATE` para `authenticated` sobre esa columna; solo la función la toca.     |
| Pago doble de puntos por reportes adicionales después del 10º | `UPDATE posts SET hidden_at = now() WHERE … AND hidden_at IS NULL` + `IF FOUND` — el pago ocurre **una sola vez**, en la transacción que cruza el umbral. |
| Revelar identidad de reportantes                | `post_reports_read_self`: cada reportante solo ve sus propias filas.                       |
| Cuentas anónimas reportando                     | RPC rechaza si `auth.uid()` es NULL.                                                       |

### 11.11 Limitaciones conocidas / pendientes

Lo que **no** está implementado y se podría añadir:

1. **Cap diario de puntos por reportes validados.** El catálogo dice `validatedReport.dailyLimit = 3`. Hoy no se enforce: si un usuario reporta 30 posts y los 30 cruzan el umbral el mismo día, recibe `30 × 10 = 300` puntos. Para limitarlo: añadir columna `awarded boolean default false` a `post_reports`, contar awards del día por reportante antes de pagar, marcar la fila como `awarded = true` al sumar.
2. **Penalización al autor del post bloqueado.** §4 sugiere `-10 pts`. Implementación: dentro del bloque `IF FOUND` del `report_post()`, `UPDATE profiles SET points = greatest(points - 10, 0) WHERE id = v_author`.
3. **Dashboard de moderación.** No hay vista para admins de ver posts más reportados, desbloquear manualmente, ni revisar reportes pendientes. Sería migración 0015 + página `/moderation` filtrada por rol.
4. **Apelación / desbloqueo por el autor.** Un autor cuyo post fue bloqueado no tiene forma de pedir revisión. Hoy es definitivo.
5. **Cooldown entre reportes del mismo usuario.** Un usuario puede reportar 100 posts en un minuto. Para evitar abuso de masa: `cooldownSec` en la función, validando contra el `created_at` más reciente del mismo `reporter_id`.
6. **Métricas anti-abuso de reporters.** Si un usuario reporta sistemáticamente posts que nunca llegan al umbral, podría estar usando el sistema para acosar. Detectarlo requiere un job que mire la relación reportes-emitidos / reportes-validados por reporter.

### 11.12 Archivos involucrados

| Archivo                                          | Rol                                                                  |
|--------------------------------------------------|----------------------------------------------------------------------|
| [`supabase/migrations/0014_post_reports.sql`](supabase/migrations/0014_post_reports.sql) | Esquema, RLS, función `report_post()`.                                |
| [`src/data/api.js`](src/data/api.js)             | `reportPost()` (wrapper del RPC), `postFromRow` (mapea `hiddenAt`/`hiddenReason`), realtime UPDATE en `posts`. |
| [`src/pages/wall.js`](src/pages/wall.js)         | Modal de categorías (`showReportModal`), banner de "oculto" en `renderPostCard`, ocultar botón de bandera en posts propios. |
| [`src/data/mock-data.js`](src/data/mock-data.js) | `getNotifications()` deriva notificación `kind: 'blocked'` cuando hay posts propios con `hiddenAt`. |
| [`src/pages/notifications.js`](src/pages/notifications.js) | `KIND_META.blocked` y soporte para notificaciones `system: true` sin actor. |
| [`src/styles/main.css`](src/styles/main.css)     | Clases `.post-card-hidden`, `.post-hidden-banner`, `.report-reason-btn`. |

---

_Última actualización: durante la auditoría técnica y refactor del proyecto. Cualquier cambio futuro a la economía de puntos debería actualizarse en este archivo junto con el código._
