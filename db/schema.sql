-- ═══════════════════════════════════════════════════════════════════════════
-- SCHEMA: Monitor de Posturas Web
-- Convenciones: snake_case, nombres en inglés, constraints explícitos
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ═══════════════════════════════════════
-- TABLA 1: sessions
-- Una fila por sesión de monitoreo completa.
-- Se crea al iniciar detección y se cierra al detener.
-- ═══════════════════════════════════════
create table if not exists sessions (
  id              uuid        default gen_random_uuid() primary key,
  user_uuid       text        not null,
  camera_view     text        not null check (camera_view in ('frontal', 'lateral', 'auto')),
  started_at      timestamptz default now(),
  ended_at        timestamptz,
  duration_sec    integer     generated always as (
                    extract(epoch from (ended_at - started_at))::integer
                  ) stored,
  total_frames    integer     default 0,
  alerts_sent     integer     default 0,
  pct_correct     float,
  device_info     text,
  consented       boolean     not null default false
);

create index if not exists idx_sessions_user    on sessions(user_uuid);
create index if not exists idx_sessions_started on sessions(started_at);
create index if not exists idx_sessions_view    on sessions(camera_view);

-- ═══════════════════════════════════════
-- TABLA 2: posture_frames
-- Una fila por frame muestreado (no 30fps).
-- Referencia sessions para agrupación temporal.
-- ═══════════════════════════════════════
create table if not exists posture_frames (
  id                uuid        default gen_random_uuid() primary key,
  session_id        uuid        not null references sessions(id) on delete cascade,
  user_uuid         text        not null,
  captured_at       timestamptz default now(),

  -- Clasificación
  posture_label     text        not null check (posture_label in ('TUP','TLF','TLB','TLL','TLR')),
  confidence        float       check (confidence between 0.0 and 1.0),
  model_used        text        not null check (model_used in ('frontal','lateral')),
  camera_view       text        not null check (camera_view in ('frontal','lateral')),
  dx_shoulders      float,

  -- Dataset: landmarks completos de MediaPipe (99 features)
  landmarks         jsonb       not null,

  -- Validación manual para supervisar calidad del dataset
  validated_label   text        check (validated_label in ('TUP','TLF','TLB','TLL','TLR')),
  is_valid_sample   boolean     default true,
  sample_every_n    integer     default 60
);

create index if not exists idx_frames_session   on posture_frames(session_id);
create index if not exists idx_frames_user      on posture_frames(user_uuid);
create index if not exists idx_frames_captured  on posture_frames(captured_at);
create index if not exists idx_frames_label     on posture_frames(posture_label);
create index if not exists idx_frames_view      on posture_frames(camera_view);
create index if not exists idx_frames_valid     on posture_frames(is_valid_sample);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table sessions       enable row level security;
alter table posture_frames enable row level security;

drop policy if exists "sessions_insert_anon"  on sessions;
drop policy if exists "sessions_select_anon"  on sessions;
drop policy if exists "sessions_update_anon"  on sessions;
drop policy if exists "frames_insert_anon"    on posture_frames;
drop policy if exists "frames_select_anon"    on posture_frames;

create policy "sessions_insert_anon" on sessions for insert with check (true);
create policy "sessions_select_anon" on sessions for select using (true);
create policy "sessions_update_anon" on sessions for update using (true);
create policy "frames_insert_anon"   on posture_frames for insert with check (true);
create policy "frames_select_anon"   on posture_frames for select using (true);

-- ── VISTAS PARA EXPORTAR DATASETS ──────────────────────────────────────────
create or replace view v_dataset_frontal as
select
  f.user_uuid,
  f.session_id,
  f.captured_at,
  f.posture_label                              as label,
  coalesce(f.validated_label, f.posture_label) as label_final,
  f.confidence,
  f.dx_shoulders,
  f.landmarks
from posture_frames f
where f.camera_view = 'frontal'
  and f.is_valid_sample = true
order by f.captured_at;

create or replace view v_dataset_lateral as
select
  f.user_uuid,
  f.session_id,
  f.captured_at,
  f.posture_label                              as label,
  coalesce(f.validated_label, f.posture_label) as label_final,
  f.confidence,
  f.dx_shoulders,
  f.landmarks
from posture_frames f
where f.camera_view = 'lateral'
  and f.is_valid_sample = true
order by f.captured_at;

-- Para exportar como CSV:
-- copy (select * from v_dataset_frontal) to '/tmp/dataset_frontal.csv' csv header;
-- copy (select * from v_dataset_lateral) to '/tmp/dataset_lateral.csv' csv header;
