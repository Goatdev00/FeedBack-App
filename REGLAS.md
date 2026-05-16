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
| Reporte validado por usuarios                       | +10    | 3             | ⏳ Inferido  |
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

### 3.8 Reporte validado — +10 pts (Inferido)

- En las publicaciones existe la categoría `REPORT_CATEGORIES` (ambiente, seguridad, música, aforo, energía, filas, problemas, highlights). Si N usuarios concuerdan en el mismo reporte sobre la misma fiesta dentro de una ventana, los reportantes deberían recibir +10.

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

_Última actualización: durante la auditoría técnica y refactor del proyecto. Cualquier cambio futuro a la economía de puntos debería actualizarse en este archivo junto con el código._
