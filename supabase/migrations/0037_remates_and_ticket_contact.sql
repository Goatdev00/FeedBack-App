-- =====================================================================
-- FEEDBACK — Remates (afters creados por cualquier usuario) + contacto
-- de boletería del promotor + muro con pestañas Fiestas/Remates
-- =====================================================================
-- Tres features de datos en una migración porque comparten tablas:
--
--   1. parties.kind ('party'|'remate') — un remate ES una fila de
--      parties: hereda gratis las salas de chat automáticas (0002:119),
--      el archivo de 7 días (0021/0032), el soft-delete en cascada
--      (0033) y todo el realtime. La ÚNICA diferencia es quién puede
--      crearlo: parties_create se relaja para que CUALQUIER usuario
--      autenticado cree kind='remate' (las fiestas siguen siendo solo
--      de promotores). promoter_id = creador también para remates, así
--      parties_update_owner / parties_delete_owner / is_party_host
--      funcionan sin cambios.
--
--   2. parties.ticket_contact_url — enlace de venta de boletas que el
--      promotor pega al crear la fiesta (el cliente normaliza números
--      de WhatsApp a https://wa.me/<num>). Solo https y corto: patrón
--      anti-data-URL de 0024.
--
--   3. posts.wall ('fiestas'|'remates') + party_id nullable — el muro
--      se divide en dos pestañas y SOLO la pestaña remates admite posts
--      libres (sin evento). Como party_visible(NULL) = TRUE (0021), un
--      post sin fiesta jamás archivaría: posts_read gana una ventana
--      explícita de 7 días para posts sin party.
--
-- Idempotente: do-blocks para type/constraints, drop policy/trigger if
-- exists, add column if not exists. Corre entera en una pasada en el
-- SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1a. parties.kind — enum + columna + índice. Enum (y no text+check)
-- para que el propio tipo documente los dos valores posibles y un
-- typo del cliente falle en el cast, no se cuele como string.
-- ---------------------------------------------------------------------
do $$ begin
  create type public.party_kind as enum ('party', 'remate');
exception when duplicate_object then null; end $$;

alter table public.parties
  add column if not exists kind public.party_kind not null default 'party';

create index if not exists parties_kind_idx on public.parties(kind);

-- ---------------------------------------------------------------------
-- 1b. parties_create — abrir INSERT a cualquier autenticado SOLO para
-- kind='remate'. El predicado de promotor se conserva textual para las
-- fiestas; is_admin() permite al admin crear cualquiera de los dos.
-- promoter_id = auth.uid() sigue siendo obligatorio SIEMPRE: es la
-- columna de propiedad de la que cuelgan update/delete/host/moderación.
-- ---------------------------------------------------------------------
drop policy if exists parties_create on public.parties;
create policy parties_create on public.parties
  for insert to authenticated
  with check (
    promoter_id = auth.uid()
    and (
      kind = 'remate'
      or (select role from public.profiles where id = auth.uid()) = 'promotor'
      or public.is_admin(auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- 1c. CONGELAR kind en UPDATE. parties_update_owner (0003:58) solo
-- exige promoter_id = auth.uid(), así que sin esto un raver crearía un
-- remate y lo flipearía a kind='party', saltándose por completo el gate
-- de promotor que protege la agenda de fiestas. WITH CHECK no puede ver
-- OLD (mismo motivo que 0031), de modo que se pina por trigger: para un
-- no-admin el UPDATE se aplica pero kind vuelve silenciosamente a su
-- valor anterior. auth.uid() IS NULL = service_role / SQL editor.
-- ---------------------------------------------------------------------
create or replace function public.freeze_party_kind()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin(auth.uid()) or auth.uid() is null then
    return new;  -- admin / service_role / SQL editor: puede reclasificar.
  end if;
  new.kind := old.kind;
  return new;
end;
$$;

drop trigger if exists before_update_freeze_party_kind on public.parties;
create trigger before_update_freeze_party_kind
  before update on public.parties
  for each row execute function public.freeze_party_kind();

-- ---------------------------------------------------------------------
-- 1d. block_if_muted en parties. Mientras el INSERT era solo-promotor
-- esto era irrelevante (0034 lo dejó fuera a propósito); al abrir la
-- creación de remates a todo el mundo, un usuario muteado/baneado no
-- debe poder crear eventos. Mismo trigger uniforme de 0034:25.
-- ---------------------------------------------------------------------
drop trigger if exists before_insert_block_if_muted on public.parties;
create trigger before_insert_block_if_muted
  before insert on public.parties
  for each row execute function public.block_if_muted();

-- ---------------------------------------------------------------------
-- 2. ticket_contact_url — solo https, ≤500 chars, nunca data-URLs
-- (patrón 0024: el CHECK vive en el servidor porque la validación del
-- cliente es bypasseable por PostgREST directo).
-- ---------------------------------------------------------------------
alter table public.parties
  add column if not exists ticket_contact_url text;

do $$ begin
  alter table public.parties
    add constraint parties_ticket_contact_url_ck
    check (
      ticket_contact_url is null
      or (
        length(ticket_contact_url) <= 500
        and ticket_contact_url like 'https://%'
        and ticket_contact_url not like 'data:%'
      )
    );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 3a. posts: party_id opcional + columna wall. DROP NOT NULL es
-- idempotente. Los posts libres (party_id NULL) solo se permiten en la
-- pestaña remates (posts_fiestas_linked_ck): en fiestas todo post nace
-- ligado a un evento, como hasta hoy.
-- ---------------------------------------------------------------------
alter table public.posts
  alter column party_id drop not null;

alter table public.posts
  add column if not exists wall text not null default 'fiestas';

do $$ begin
  alter table public.posts
    add constraint posts_wall_ck
    check (wall in ('fiestas', 'remates'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.posts
    add constraint posts_fiestas_linked_ck
    check (wall = 'remates' or party_id is not null);
exception when duplicate_object then null; end $$;

-- El feed de cada pestaña filtra por wall y ordena por fecha.
create index if not exists posts_wall_idx on public.posts(wall, created_at desc);

-- ---------------------------------------------------------------------
-- 3b. Coherencia wall ↔ kind: un post ligado a un evento debe vivir en
-- la pestaña del kind de ese evento (party→fiestas, remate→remates).
-- Trigger y no RLS with-check porque (a) es más legible y (b) el
-- payload de realtime no trae joins, así que el cliente confía en que
-- la fila ya nació coherente. SECURITY DEFINER: lee parties sin pasar
-- por su RLS (la visibilidad del evento ya la garantiza el flujo de
-- creación). También en UPDATE: posts_update_owner permite cambiar
-- party_id/wall, y sin esto un usuario re-colgaría el post de un evento
-- del kind contrario después de nacer.
-- ---------------------------------------------------------------------
create or replace function public.check_post_party_kind()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind public.party_kind;
begin
  if new.party_id is null then
    return new;  -- post libre: posts_fiestas_linked_ck ya lo restringe a remates.
  end if;
  select kind into v_kind from public.parties where id = new.party_id;
  if v_kind is null then
    raise exception 'party_not_found';
  end if;
  if (new.wall = 'remates') <> (v_kind = 'remate') then
    raise exception 'post_wall_party_kind_mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists before_write_check_post_party_kind on public.posts;
create trigger before_write_check_post_party_kind
  before insert or update on public.posts
  for each row execute function public.check_post_party_kind();

-- ---------------------------------------------------------------------
-- 3c. posts_read — texto VIGENTE de 0032 (admin override + carve-out de
-- reportes 0014/0018 + visibilidad del evento padre 0021 + soft-delete)
-- MÁS la ventana de 7 días para posts sin evento: party_visible(NULL)
-- devuelve TRUE (es el caso del chat global), así que sin esta cláusula
-- un post libre de remates viviría para siempre en el muro.
-- ---------------------------------------------------------------------
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or (
      (hidden_at is null or user_id = auth.uid())
      and public.party_visible(party_id)
      and deleted_at is null
      and (party_id is not null or created_at > now() - interval '7 days')
    )
  );

notify pgrst, 'reload schema';
