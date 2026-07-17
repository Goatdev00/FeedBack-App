-- =====================================================================
-- FEEDBACK — 0040: bucket público de IMÁGENES en Storage
-- =====================================================================
-- Por qué: las fotos de posts, flyers y avatares viven hoy como base64
-- dentro de columnas text (0024 las capa a 2M chars). Eso hace que:
--   * el feed baje MEGAS de JSON en cada hidratación (lento en gama
--     baja / redes móviles),
--   * las imágenes no puedan cachearse como recursos HTTP (cada boot
--     las re-descarga),
--   * la caché local tenga que podarlas por la cuota de localStorage
--     (el muro repinta sin fotos en cada entrada).
-- A partir de esta migración el cliente sube las imágenes NUEVAS al
-- bucket `images` y guarda solo la URL pública (las columnas ya aceptan
-- URLs — los checks de 0024 son de longitud). Las base64 viejas siguen
-- renderizando igual; el contenido converge solo a URLs con el uso.
-- Mismo patrón que el bucket `videos` de 0039.
--
-- NOTA (igual que 0039): si `create policy` sobre storage.objects falla
-- en el SQL editor con "must be owner of table objects", crear las dos
-- policies desde Dashboard → Storage → Policies con estos predicados.
-- =====================================================================

-- Bucket público. 5MB de tope: el cliente SIEMPRE re-encoda a JPEG
-- (1280px posts/flyers, 256px avatares → 50-400KB reales); 5MB es red
-- de seguridad, no presupuesto. Lectura pública vía CDN — necesario
-- para <img src> sin headers.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'images',
  'images',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Escritura: cada usuario SOLO dentro de su carpeta <uid>/... (evita
-- que alguien pise archivos ajenos); borrado solo de lo propio.
drop policy if exists images_insert_own on storage.objects;
create policy images_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists images_delete_own on storage.objects;
create policy images_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'images'
    and owner = auth.uid()
  );

-- Sin SELECT policy: el bucket es público (lectura por URL de CDN).
