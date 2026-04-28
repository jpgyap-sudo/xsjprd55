-- ============================================================
-- AI Debug Crawler Schema — xsjprd55
-- Run in Supabase SQL Editor before deploying the crawler.
-- ============================================================

create extension if not exists pgcrypto;

-- ── Main bug tracking table ─────────────────────────────────
create table if not exists bugs_to_fix (
  id              uuid primary key default gen_random_uuid(),
  source_agent    text default 'debug_crawler_agent',
  title           text not null,
  description     text,
  severity        text default 'medium'
                    check (severity in ('low','medium','high','critical')),
  priority        int default 3,
  status          text default 'new'
                    check (status in (
                      'new','investigating','fixing','fixed',
                      'verified','wont_fix','duplicate','blocked'
                    )),
  file_path       text,
  affected_area   text,
  recommendation  text,
  detected_at     timestamptz default now(),
  fixed_at        timestamptz,
  verified_at     timestamptz,
  fixed_by        text,
  fix_commit      text,
  fix_notes       text,
  fingerprint     text unique,
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_bugs_status_detected on bugs_to_fix(status, detected_at desc);
create index if not exists idx_bugs_severity        on bugs_to_fix(severity);
create index if not exists idx_bugs_file_path       on bugs_to_fix(file_path);
create index if not exists idx_bugs_fingerprint     on bugs_to_fix(fingerprint);

-- ── Status history audit trail ──────────────────────────────
create table if not exists bug_status_history (
  id          uuid primary key default gen_random_uuid(),
  bug_id      uuid references bugs_to_fix(id) on delete cascade,
  old_status  text,
  new_status  text not null,
  note        text,
  changed_by  text,
  changed_at  timestamptz default now()
);

-- ── Debug crawler run logs ──────────────────────────────────
create table if not exists debug_crawler_runs (
  id              uuid primary key default gen_random_uuid(),
  status          text default 'running'
                    check (status in ('running','completed','failed')),
  started_at      timestamptz default now(),
  completed_at    timestamptz,
  files_scanned   int default 0,
  findings_count  int default 0,
  critical_count  int default 0,
  high_count      int default 0,
  medium_count    int default 0,
  low_count       int default 0,
  summary         text,
  metadata        jsonb default '{}'::jsonb,
  error           text
);

-- ── Trigger: auto-update updated_at + history + timestamps ──
create or replace function update_bugs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();

  -- Auto-set fixed_at
  if old.status is distinct from new.status then
    if new.status = 'fixed' and new.fixed_at is null then
      new.fixed_at = now();
    end if;

    -- Auto-set verified_at
    if new.status = 'verified' and new.verified_at is null then
      new.verified_at = now();
    end if;

    -- Record history
    insert into bug_status_history (
      bug_id,
      old_status,
      new_status,
      note,
      changed_by
    ) values (
      new.id,
      old.status,
      new.status,
      new.fix_notes,
      new.fixed_by
    );
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_update_bugs_updated_at on bugs_to_fix;
create trigger trg_update_bugs_updated_at
  before update on bugs_to_fix
  for each row
  execute function update_bugs_updated_at();
