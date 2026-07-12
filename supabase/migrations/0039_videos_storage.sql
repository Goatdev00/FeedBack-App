-- =====================================================================
-- FEEDBACK — Videos ≤30s: bucket de Storage + columnas video_url
-- =====================================================================
-- Primer uso de Supabase Storage en el producto (0024 ya lo anticipaba:
-- "when uploads move to Supabase Storage…"). SOLO videos — las imágenes
-- siguen el pipeline base64 actual.
--
--   * Bucket público `videos`: la lectura va por la URL pública del CDN
--     (sin policy de SELECT); el contenido de fiesta es público de
--     todos modos y las URLs firmadas complicarían la caché del SW.
--     file_size_limit 25 MB + allowed_mime_types: el servidor rechaza
--     lo que el cliente no debió mandar (la duración ≤30s se valida en
--     cliente vía metadata; un probe server-side vendría después).
--   * Escritura solo en TU carpeta: la convención de path es
--     <user_id>/v_<ts>.<ext>, y la policy exige que el primer folder
--     sea auth.uid() — nadie sobreescribe ni llena la carpeta de otro.
--   * posts.video_url / chat_messages.video_url: URL https corta, JAMÁS
--     data-URLs (la lección de 0013/0024: un solo video base64 en una
--     fila tumbaría el muro con statement-timeout).
--   * posts.type gana 'video'; chat_messages.content se vuelve opcional
--     SOLO cuando el mensaje lleva video (mensaje "solo video").
--
-- Los CHECKs originales de 0001 son inline (column constraints), así
-- que sus nombres son los autogenerados posts_type_check /
-- chat_messages_content_check — pero por si el nombre difiere en algún
-- entorno, se localizan por definición en pg_constraint y se dropean
-- por do-block antes de re-crearlos con nombre explícito.
--
-- Idempotente: corre entera en una pasada en el SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Bucket `videos` (público). 26214400 = 25 MB — holgado para 30s de
-- 720p H.264 y aún pequeño para abuso.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 26214400, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Policies de storage.objects: subir solo a tu propia carpeta,
-- borrar solo lo tuyo. Bucket público → sin policy de SELECT (el CDN
-- sirve por URL pública).
-- ---------------------------------------------------------------------
drop policy if exists videos_insert_own on storage.objects;
create policy videos_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists videos_delete_own on storage.objects;
create policy videos_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'videos'
    and owner = auth.uid()
  );

-- ---------------------------------------------------------------------
-- 3. posts.video_url + type 'video'.
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists video_url text;

do $$ begin
  alter table public.posts
    add constraint posts_video_url_ck
    check (
      video_url is null
      or (
        length(video_url) <= 500
        and video_url like 'https://%'
        and video_url not like 'data:%'
      )
    );
exception when duplicate_object then null; end $$;

-- Ampliar el CHECK de type: se localiza el constraint vigente por su
-- definición (`type = ANY …` solo puede ser este) por si el nombre no
-- es el autogenerado, y se re-crea con 'video' incluido.
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.posts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%type = ANY%'
  loop
    execute format('alter table public.posts drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.posts drop constraint if exists posts_type_check;

do $$ begin
  alter table public.posts
    add constraint posts_type_check
    check (type in ('text', 'photo', 'video'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 4. chat_messages.video_url + content opcional en mensajes solo-video.
-- El resto del contrato de chat (snapshot_message_meta, policies 0009,
-- soft-delete 0031) no depende del NOT NULL de content — sin cambios.
-- ---------------------------------------------------------------------
alter table public.chat_messages
  add column if not exists video_url text;

do $$ begin
  alter table public.chat_messages
    add constraint chat_messages_video_url_ck
    check (
      video_url is null
      or (
        length(video_url) <= 500
        and video_url like 'https://%'
        and video_url not like 'data:%'
      )
    );
exception when duplicate_object then null; end $$;

alter table public.chat_messages
  alter column content drop not null;

-- Sustituir el CHECK de longitud original (inline en 0001:263) por la
-- regla nueva: o hay texto 1..500, o no hay texto pero sí video. Un
-- mensaje sin texto Y sin video sigue siendo inválido.
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.chat_messages'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%length(content)%'
  loop
    execute format('alter table public.chat_messages drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.chat_messages drop constraint if exists chat_messages_content_check;

do $$ begin
  alter table public.chat_messages
    add constraint chat_messages_content_check
    check (
      (content is not null and char_length(content) between 1 and 500)
      or (content is null and video_url is not null)
    );
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
