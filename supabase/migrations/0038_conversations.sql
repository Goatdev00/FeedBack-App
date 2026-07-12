-- =====================================================================
-- FEEDBACK — Mensajería privada: DMs y grupos (conversations)
-- =====================================================================
-- Tablas NUEVAS y dedicadas — chat_rooms / chat_messages / su enum NO se
-- tocan: las salas públicas por fiesta y la mensajería privada tienen
-- reglas de visibilidad opuestas (todo el mundo vs. solo miembros) y
-- mezclarlas en una tabla obligaría a policies condicionales frágiles.
--
--   * conversations         — cabecera: 'dm' (par único, dedupe por
--                             dm_key) o 'group' (título + foto, creador
--                             = owner).
--   * conversation_members  — membresía + mute por conversación +
--                             last_read_at (unread).
--   * conversation_messages — mensajes con soft-delete (0031) y las
--                             mismas caps de media que el resto de la
--                             app (0024: imagen base64 ≤2M, video solo
--                             URL https corta — 0039 crea el bucket).
--
-- SEGURIDAD (las decisiones no obvias):
--   * is_conversation_member() SECURITY DEFINER — las policies de
--     conversation_members NO pueden consultar conversation_members en
--     su propio USING (Postgres: "infinite recursion detected in
--     policy"); el helper bypassea RLS igual que is_party_host (0002).
--   * La CREACIÓN va por RPCs SECURITY DEFINER (create_dm /
--     create_group): insertar la conversación y sus member rows es un
--     huevo-y-gallina bajo RLS (para insertarte como miembro tendrías
--     que ya ser miembro). No hay policy de INSERT/DELETE de cliente en
--     conversations ni de INSERT en conversation_members: RLS activa
--     sin policy = denegado.
--   * Freeze por trigger de la fila de miembro: la policy de UPDATE
--     permite al usuario tocar SU fila (muted / last_read_at), pero
--     WITH CHECK no ve OLD, así que role / joined_at / conversation_id
--     / user_id se pinan por trigger (patrón 0031) — sin esto un
--     miembro se auto-promociona a owner o muda su membresía a otra
--     conversación.
--   * created_at de cada mensaje se pina a now() por trigger: el
--     cliente podría falsificarlo (p.ej. año 2999) y, vía el bump
--     "solo adelante" de last_message_at, clavar la conversación
--     arriba del inbox de todos para siempre.
--   * Freeze de conversations: el owner solo puede tocar title /
--     photo_url; el bump legítimo de last_message_at se distingue del
--     UPDATE directo del cliente por pg_trigger_depth() (ver trigger).
--   * Los helpers is_conversation_member/owner se revocan de PUBLIC y
--     anon (grant a authenticated OBLIGATORIO: las policies los
--     evalúan con los privilegios del usuario que consulta).
--   * Renombrar/foto del grupo: solo owner y solo kind='group'
--     (conversations_update_owner). Un DM no tiene título ni owner.
--
-- Realtime: se publican conversation_messages y conversations; WALRUS
-- evalúa la policy de SELECT por suscriptor, así que los mensajes solo
-- llegan a miembros (y el bump de last_message_at también).
--
-- Idempotente: corre entera en una pasada en el SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipos y tablas
-- ---------------------------------------------------------------------
do $$ begin
  create type public.conversation_kind as enum ('dm', 'group');
exception when duplicate_object then null; end $$;

-- dm_key = least(uidA,uidB)::text || ':' || greatest(...)::text — la
-- clave canónica del par. UNIQUE evita que dos requests simultáneos
-- creen dos hilos paralelos para el mismo par (create_dm se apoya en el
-- conflicto). NULL en grupos (el CHECK de abajo lo exige).
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  kind            public.conversation_kind not null,
  -- título solo para grupos, 1..60 (los DMs muestran el nombre del otro)
  title           text check (title is null or char_length(title) between 1 and 60),
  -- foto de grupo base64 estilo avatar: cap de 0024 (256px ≈ 55K, 150K = 3x holgura)
  photo_url       text check (photo_url is null or length(photo_url) <= 150000),
  created_by      uuid references public.profiles(id) on delete set null,
  dm_key          text unique,
  -- orden del inbox; lo bumpa el trigger de cada mensaje nuevo
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  check (
    (kind = 'dm'    and dm_key is not null and title is null)
    or
    (kind = 'group' and dm_key is null     and title is not null)
  )
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  role            text not null default 'member' check (role in ('owner', 'member')),
  muted           boolean not null default false,
  -- unread = último mensaje ajeno posterior a mi last_read_at
  last_read_at    timestamptz not null default now(),
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
-- listConversations entra por usuario; el PK ya cubre la entrada por conversación.
create index if not exists conversation_members_user_idx on public.conversation_members(user_id);

create table if not exists public.conversation_messages (
  id              uuid not null primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  content         text check (content is null or char_length(content) between 1 and 500),
  -- imagen: base64 como posts (cap 0024); video: SOLO URL https corta al
  -- bucket de Storage (0039) — jamás data-URLs de video (ver 0013/0024).
  image_url       text check (image_url is null or length(image_url) <= 2000000),
  video_url       text check (
                    video_url is null
                    or (
                      length(video_url) <= 500
                      and video_url like 'https://%'
                      and video_url not like 'data:%'
                    )
                  ),
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles(id) on delete set null,
  deleted_reason  text,
  -- un mensaje vacío no existe: texto, imagen o video (al menos uno)
  check (content is not null or image_url is not null or video_url is not null)
);
create index if not exists conversation_messages_conv_idx
  on public.conversation_messages(conversation_id, created_at desc);
-- partial index para la vista de papelera (patrón 0031): el hot path
-- filtra deleted_at is null, solo las (pocas) filas borradas se indexan.
create index if not exists conversation_messages_deleted_idx
  on public.conversation_messages(deleted_at) where deleted_at is not null;

-- ---------------------------------------------------------------------
-- Helpers anti-recursión (patrón is_party_host 0002:42). SECURITY
-- DEFINER: leen conversation_members SIN pasar por su propia policy —
-- es lo que rompe el ciclo. STABLE para que el planner los cachee por
-- statement.
-- ---------------------------------------------------------------------
create or replace function public.is_conversation_member(p_uid uuid, p_cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = p_cid and user_id = p_uid
  );
$$;

create or replace function public.is_conversation_owner(p_uid uuid, p_cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = p_cid and user_id = p_uid and role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.conversations         enable row level security;
alter table public.conversation_members  enable row level security;
alter table public.conversation_messages enable row level security;

-- conversations: solo miembros (o admin, para moderar) ven la cabecera.
-- Sin INSERT/DELETE de cliente — creación por RPC, borrado por admin.
drop policy if exists conversations_read on public.conversations;
create policy conversations_read on public.conversations
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or public.is_conversation_member(auth.uid(), id)
  );

-- Renombrar / cambiar foto: SOLO el owner y SOLO grupos. El WITH CHECK
-- repite kind='group' para que tampoco pueda mutarse un grupo a 'dm'
-- (el CHECK de la tabla ya lo impediría, cinturón y tirantes).
drop policy if exists conversations_update_owner on public.conversations;
create policy conversations_update_owner on public.conversations
  for update to authenticated
  using (
    kind = 'group'
    and public.is_conversation_owner(auth.uid(), id)
  )
  with check (
    kind = 'group'
    and public.is_conversation_owner(auth.uid(), id)
  );

-- conversation_members: la lista de miembros solo la ven los miembros
-- (o admin) — quién habla con quién es dato privado.
drop policy if exists conversation_members_read on public.conversation_members;
create policy conversation_members_read on public.conversation_members
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or public.is_conversation_member(auth.uid(), conversation_id)
  );

-- UPDATE: cada uno SU fila (muted / last_read_at). Las columnas
-- sensibles las pina el trigger de abajo — WITH CHECK no ve OLD.
drop policy if exists conversation_members_update_self on public.conversation_members;
create policy conversation_members_update_self on public.conversation_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- DELETE: salir uno mismo, o el owner expulsa (helper: consultar
-- conversation_members dentro de su propia policy recursaría).
drop policy if exists conversation_members_delete on public.conversation_members;
create policy conversation_members_delete on public.conversation_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    or public.is_conversation_owner(auth.uid(), conversation_id)
  );

-- conversation_messages: leer = miembro y no borrado (admin ve todo,
-- incluida la papelera — plantilla 0032); escribir = miembro firmando
-- con su propio user_id.
drop policy if exists conversation_messages_read on public.conversation_messages;
create policy conversation_messages_read on public.conversation_messages
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or (
      deleted_at is null
      and public.is_conversation_member(auth.uid(), conversation_id)
    )
  );

drop policy if exists conversation_messages_create on public.conversation_messages;
create policy conversation_messages_create on public.conversation_messages
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_conversation_member(auth.uid(), conversation_id)
  );
-- Sin UPDATE/DELETE de cliente: el soft-delete es exclusivo del admin
-- (RPC de abajo); editar mensajes no es feature.

-- ---------------------------------------------------------------------
-- Trigger freeze de la fila de miembro (patrón 0031): un no-admin puede
-- cambiar muted / last_read_at, pero role / joined_at / claves quedan
-- pinadas a OLD silenciosamente. auth.uid() IS NULL = service_role /
-- SQL editor (contextos de servidor confiables).
-- ---------------------------------------------------------------------
create or replace function public.freeze_conversation_member_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin(auth.uid()) or auth.uid() is null then
    return new;
  end if;
  new.conversation_id := old.conversation_id;
  new.user_id         := old.user_id;
  new.role            := old.role;
  new.joined_at       := old.joined_at;
  return new;
end;
$$;

drop trigger if exists before_update_freeze_member_columns on public.conversation_members;
create trigger before_update_freeze_member_columns
  before update on public.conversation_members
  for each row execute function public.freeze_conversation_member_columns();

-- ---------------------------------------------------------------------
-- Triggers en conversation_messages:
--   * block_if_muted (0034) — un muteado lee pero no escribe, también
--     en privado.
--   * pin_conversation_message_created_at — pina created_at := now().
--     El cliente tiene INSERT a nivel de columna sobre created_at y el
--     WITH CHECK de la policy no lo restringe: un miembro podría
--     insertar por PostgREST un mensaje fechado en 2999 y el bump
--     "solo adelante" dejaría la conversación clavada arriba del inbox
--     de todos para siempre (ningún mensaje legítimo con now() podría
--     volver a superarla). Con el pin, el bump solo propaga timestamps
--     de servidor.
--   * freeze_soft_delete_columns (0031) — nadie salvo el admin toca el
--     tuple de soft-delete (defensa en profundidad: hoy ni siquiera hay
--     policy de UPDATE, pero si mañana se abre una para "editar
--     mensaje", el agujero no se reabre).
--   * bump_conversation_last_message — mantiene el orden del inbox.
--     SECURITY DEFINER: el que escribe no es owner del grupo, así que
--     la policy de UPDATE de conversations no le dejaría bumpear; el
--     definer (owner de la función = owner de la tabla) bypassea RLS.
--     El guard "solo adelante" evita que un mensaje que llegue fuera de
--     orden retroceda el inbox.
-- ---------------------------------------------------------------------
drop trigger if exists before_insert_block_if_muted on public.conversation_messages;
create trigger before_insert_block_if_muted
  before insert on public.conversation_messages
  for each row execute function public.block_if_muted();

create or replace function public.pin_conversation_message_created_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- admin / service_role (auth.uid() null = SQL editor, backfills) pueden
  -- insertar con fechas históricas reales; el cliente normal escribe
  -- SIEMPRE la hora del servidor (mismas exenciones que el freeze 0031).
  if public.is_admin(auth.uid()) or auth.uid() is null then
    return new;
  end if;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists before_insert_pin_created_at on public.conversation_messages;
create trigger before_insert_pin_created_at
  before insert on public.conversation_messages
  for each row execute function public.pin_conversation_message_created_at();

drop trigger if exists before_update_freeze_soft_delete on public.conversation_messages;
create trigger before_update_freeze_soft_delete
  before update on public.conversation_messages
  for each row execute function public.freeze_soft_delete_columns();

create or replace function public.bump_conversation_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id
     and last_message_at < new.created_at;
  return new;
end;
$$;

drop trigger if exists after_insert_bump_conversation on public.conversation_messages;
create trigger after_insert_bump_conversation
  after insert on public.conversation_messages
  for each row execute function public.bump_conversation_last_message();

-- ---------------------------------------------------------------------
-- Freeze de conversations (espejo del freeze de member rows): la policy
-- conversations_update_owner deja al owner tocar title/photo_url, pero
-- una policy no ve OLD, así que sin este trigger también podría
-- reescribir kind/dm_key/created_by/created_at/last_message_at (p.ej.
-- clavar last_message_at en 2999 y fijar su grupo arriba del inbox de
-- todos los miembros para siempre).
--
-- last_message_at tiene un matiz: SÍ debe poder cambiar, pero solo vía
-- bump_conversation_last_message. El bump es SECURITY DEFINER, pero los
-- triggers BEFORE UPDATE disparan igual en su UPDATE y auth.uid() sigue
-- siendo el del remitente (un no-admin cualquiera) — por rol no se
-- puede distinguir. El truco: pg_trigger_depth(). DENTRO de este
-- trigger la profundidad nunca es 0: un UPDATE directo del cliente da
-- depth = 1 (solo este trigger en la pila); el UPDATE del bump corre
-- dentro del AFTER INSERT de conversation_messages, así que aquí se ve
-- depth = 2. Solo el camino anidado (el bump) mueve last_message_at.
-- Es seguro porque un cliente no puede fabricar otro UPDATE anidado
-- sobre conversations (no puede crear triggers), y el único valor que
-- el bump propaga es new.created_at, ya pinado a now() en el INSERT.
-- ---------------------------------------------------------------------
create or replace function public.freeze_conversation_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin(auth.uid()) or auth.uid() is null then
    return new;
  end if;
  new.kind       := old.kind;
  new.dm_key     := old.dm_key;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if pg_trigger_depth() = 1 then
    -- UPDATE directo del cliente (el owner vía conversations_update_owner
    -- solo puede tocar title/photo_url): last_message_at queda pinado.
    new.last_message_at := old.last_message_at;
  end if;
  return new;
end;
$$;

drop trigger if exists before_update_freeze_conversation_columns on public.conversations;
create trigger before_update_freeze_conversation_columns
  before update on public.conversations
  for each row execute function public.freeze_conversation_columns();

-- ---------------------------------------------------------------------
-- create_dm(p_other) — devuelve el id del DM con p_other, creándolo si
-- no existe. SECURITY DEFINER: inserta cabecera + 2 member rows en una
-- transacción, cosa imposible bajo RLS de cliente. El ON CONFLICT sobre
-- dm_key resuelve la carrera de dos usuarios abriendo el mismo DM a la
-- vez. Si uno de los dos había salido del hilo, se le re-inserta
-- (semántica WhatsApp: escribirle a alguien reabre el DM).
-- ---------------------------------------------------------------------
create or replace function public.create_dm(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_key text;
  v_id  uuid;
begin
  if v_me is null then raise exception 'unauthorized'; end if;
  if p_other is null or p_other = v_me then raise exception 'invalid_target'; end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'user_not_found';
  end if;
  -- espejo de block_if_muted: la RPC bypassea RLS y triggers de otras
  -- tablas, así que el gate de mute se re-declara aquí.
  if public.is_muted(v_me) and not public.is_admin(v_me) then
    raise exception 'user_muted';
  end if;

  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);

  select id into v_id from public.conversations where dm_key = v_key;
  if v_id is null then
    insert into public.conversations (kind, dm_key, created_by)
    values ('dm', v_key, v_me)
    on conflict (dm_key) do nothing
    returning id into v_id;
    if v_id is null then
      -- carrera perdida: el otro request lo creó entre el SELECT y el INSERT.
      select id into v_id from public.conversations where dm_key = v_key;
    end if;
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (v_id, v_me), (v_id, p_other)
  on conflict (conversation_id, user_id) do nothing;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- create_group(p_title, p_photo, p_members) — crea el grupo con el
-- caller como owner. Valida en servidor lo que el cliente ya valida en
-- UI (título 1..60, foto ≤ cap avatar, ≤30 miembros contando al owner):
-- PostgREST directo no debe poder saltarse nada. Miembros inexistentes,
-- duplicados o el propio caller se descartan en silencio.
-- ---------------------------------------------------------------------
create or replace function public.create_group(
  p_title   text,
  p_photo   text default null,
  p_members uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_title   text := trim(coalesce(p_title, ''));
  v_members uuid[];
  v_id      uuid;
begin
  if v_me is null then raise exception 'unauthorized'; end if;
  if public.is_muted(v_me) and not public.is_admin(v_me) then
    raise exception 'user_muted';
  end if;
  if char_length(v_title) not between 1 and 60 then
    raise exception 'invalid_title';
  end if;
  if p_photo is not null and length(p_photo) > 150000 then
    raise exception 'photo_too_large';
  end if;

  select array_agg(distinct m) into v_members
  from unnest(coalesce(p_members, '{}')) as t(m)
  where m is not null
    and m <> v_me
    and exists (select 1 from public.profiles p where p.id = m);

  if v_members is null or array_length(v_members, 1) = 0 then
    raise exception 'no_members';
  end if;
  if array_length(v_members, 1) + 1 > 30 then
    raise exception 'group_too_large';
  end if;

  insert into public.conversations (kind, title, photo_url, created_by)
  values ('group', v_title, p_photo, v_me)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_id, v_me, 'owner');

  insert into public.conversation_members (conversation_id, user_id)
  select v_id, m from unnest(v_members) as t(m);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- add_group_members(p_conv, p_members) — solo el owner añade gente,
-- respetando el cap de 30. Los ya-miembros / inexistentes se descartan
-- en silencio (idempotente frente a doble tap del cliente).
-- ---------------------------------------------------------------------
create or replace function public.add_group_members(p_conv uuid, p_members uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_new     uuid[];
  v_current int;
begin
  if v_me is null then raise exception 'unauthorized'; end if;
  if public.is_muted(v_me) and not public.is_admin(v_me) then
    raise exception 'user_muted';
  end if;
  if not exists (
    select 1 from public.conversations where id = p_conv and kind = 'group'
  ) then
    raise exception 'group_not_found';
  end if;
  if not public.is_conversation_owner(v_me, p_conv) then
    raise exception 'forbidden';
  end if;

  select array_agg(distinct m) into v_new
  from unnest(coalesce(p_members, '{}')) as t(m)
  where m is not null
    and exists (select 1 from public.profiles p where p.id = m)
    and not exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = p_conv and cm.user_id = m
    );

  if v_new is null or array_length(v_new, 1) = 0 then
    return;  -- nada nuevo que añadir
  end if;

  select count(*) into v_current
  from public.conversation_members where conversation_id = p_conv;

  if v_current + array_length(v_new, 1) > 30 then
    raise exception 'group_too_large';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  select p_conv, m from unnest(v_new) as t(m)
  on conflict (conversation_id, user_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- admin_soft_delete_conversation_message — clon de
-- admin_soft_delete_chat_message (0033:95): snapshot a moderation_log +
-- soft-delete, restaurable.
-- ---------------------------------------------------------------------
create or replace function public.admin_soft_delete_conversation_message(
  p_message_id uuid,
  p_reason     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_log    uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select to_jsonb(m) into v_before
  from public.conversation_messages m
  where m.id = p_message_id and m.deleted_at is null;
  if v_before is null then raise exception 'message_not_found_or_already_deleted'; end if;

  update public.conversation_messages
     set deleted_at = now(), deleted_by = auth.uid(), deleted_reason = p_reason
   where id = p_message_id;

  insert into public.moderation_log
    (actor_id, action, target_type, target_id, reason, before_state)
  values
    (auth.uid(), 'soft_delete', 'conversation_message', p_message_id, p_reason, v_before)
  returning id into v_log;

  return v_log;
end;
$$;

-- ---------------------------------------------------------------------
-- admin_restore — re-declarada COMPLETA (create or replace sobre la
-- versión de 0033) con una única adición: la rama
-- 'conversation_message'. Sin ella, la papelera podría borrar mensajes
-- privados pero no devolverlos.
-- ---------------------------------------------------------------------
create or replace function public.admin_restore(p_log_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log moderation_log%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select * into v_log from public.moderation_log where id = p_log_id;
  if v_log.id is null then raise exception 'log_not_found'; end if;
  if v_log.action <> 'soft_delete' then raise exception 'not_a_deletion'; end if;
  if v_log.restored_at is not null then raise exception 'already_restored'; end if;

  if v_log.target_type = 'post' then
    update public.posts set deleted_at = null, deleted_by = null, deleted_reason = null
     where id = v_log.target_id;

  elsif v_log.target_type = 'comment' then
    update public.post_comments set deleted_at = null, deleted_by = null, deleted_reason = null
     where id = v_log.target_id;

  elsif v_log.target_type = 'chat_message' then
    update public.chat_messages set deleted_at = null, deleted_by = null, deleted_reason = null
     where id = v_log.target_id;

  elsif v_log.target_type = 'conversation_message' then
    update public.conversation_messages set deleted_at = null, deleted_by = null, deleted_reason = null
     where id = v_log.target_id;

  elsif v_log.target_type = 'question' then
    update public.questions set deleted_at = null, deleted_by = null, deleted_reason = null
     where id = v_log.target_id;

  elsif v_log.target_type = 'party' then
    update public.parties set deleted_at = null, deleted_by = null, deleted_reason = null
     where id = v_log.target_id;

    update public.posts set deleted_at = null, deleted_by = null, deleted_reason = null
     where id in (
       select (jsonb_array_elements_text(coalesce(v_log.manifest->'posts', '[]'::jsonb)))::uuid
     );
    update public.post_comments set deleted_at = null, deleted_by = null, deleted_reason = null
     where id in (
       select (jsonb_array_elements_text(coalesce(v_log.manifest->'comments', '[]'::jsonb)))::uuid
     );
    update public.chat_messages set deleted_at = null, deleted_by = null, deleted_reason = null
     where id in (
       select (jsonb_array_elements_text(coalesce(v_log.manifest->'messages', '[]'::jsonb)))::uuid
     );
  else
    raise exception 'unrestorable_target_type: %', v_log.target_type;
  end if;

  update public.moderation_log set restored_at = now() where id = p_log_id;

  insert into public.moderation_log
    (actor_id, action, target_type, target_id, reason)
  values
    (auth.uid(), 'restore', v_log.target_type, v_log.target_id,
     'restored log ' || p_log_id::text);
end;
$$;

-- ---------------------------------------------------------------------
-- Lock down de las RPCs (postura 0033): nada de anon/public; el cuerpo
-- de las admin_* re-verifica is_admin, y las de usuario validan por sí
-- mismas. admin_restore conserva sus grants de 0033 (create or replace
-- no toca la ACL).
-- ---------------------------------------------------------------------
revoke execute on function public.create_dm(uuid)                                   from public, anon;
revoke execute on function public.create_group(text, text, uuid[])                  from public, anon;
revoke execute on function public.add_group_members(uuid, uuid[])                   from public, anon;
revoke execute on function public.admin_soft_delete_conversation_message(uuid, text) from public, anon;

grant execute on function public.create_dm(uuid)                                    to authenticated;
grant execute on function public.create_group(text, text, uuid[])                   to authenticated;
grant execute on function public.add_group_members(uuid, uuid[])                    to authenticated;
grant execute on function public.admin_soft_delete_conversation_message(uuid, text) to authenticated;

-- Los helpers is_conversation_member / is_conversation_owner también se
-- lockean: Postgres da EXECUTE a PUBLIC por defecto y, al ser SECURITY
-- DEFINER, cualquiera (incluso anon vía /rest/v1/rpc/) podría sondear
-- la membresía de una conversación ajena — exactamente el dato que
-- conversation_members_read declara privado.
--
-- OJO CRÍTICO: las policies RLS evalúan estas funciones con los
-- privilegios del usuario de la consulta, NO con los del dueño de la
-- policy. authenticated DEBE conservar EXECUTE o toda la mensajería
-- muere con "permission denied for function". Lo que se corta es anon;
-- que un usuario autenticado que ya conozca el UUID de una conversación
-- pueda sondearla se acepta (gen_random_uuid no es adivinable — mismo
-- criterio que is_party_host 0002).
revoke execute on function public.is_conversation_member(uuid, uuid) from public, anon;
revoke execute on function public.is_conversation_owner(uuid, uuid)  from public, anon;

grant execute on function public.is_conversation_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_conversation_owner(uuid, uuid)  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- push_events.kind — distingue el ledger del fan-out de conversaciones
-- ('conversation') del de las notificaciones clásicas (null; las filas
-- viejas quedan null = clásico, que es correcto: todas lo eran). El cap
-- global 30/5min de send-push estaba calibrado para 1 fila por llamada,
-- pero el fan-out de grupos inserta 1 fila por destinatario efectivo:
-- sin distinguirlas, un chat de grupo activo quemaba el presupuesto del
-- remitente y bloqueaba en silencio hasta sus pushes de like/comment/
-- follow. Con kind, el contador global cuenta SOLO filas clásicas.
-- Sin índice nuevo: todas las queries del ledger filtran por sender_id,
-- ya cubierto por push_events_sender_idx (0029).
-- ---------------------------------------------------------------------
alter table public.push_events add column if not exists kind text;

-- ---------------------------------------------------------------------
-- Realtime (guard idempotente, patrón 0014:179). conversation_messages
-- para los mensajes en vivo; conversations para que el bump de
-- last_message_at reordene el inbox de los demás miembros. WALRUS
-- aplica la policy de SELECT por suscriptor → solo miembros reciben.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_messages'
  ) then
    alter publication supabase_realtime add table public.conversation_messages;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;

notify pgrst, 'reload schema';
