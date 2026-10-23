-- Machine-center documents (manuals, drawings, procedures, signed paperwork) shown in
-- the PM Register's "Docs" link. Files live in Google Drive (see netlify/functions/api.js);
-- this table only holds metadata and the Drive link.
-- Run this once against the project's Supabase database (SQL editor or `supabase db push`).

create table if not exists pm_documents (
  id             text primary key,
  pm_id          text not null,
  name           text not null,
  mime_type      text default '',
  size_bytes     bigint default 0,
  drive_file_id  text not null,
  url            text default '',
  uploaded_by    text default '',
  uploaded_at    timestamptz default now()
);

create index if not exists pm_documents_pm_id_idx on pm_documents (pm_id);

-- Same access as the app's other tables (the app talks to Supabase with the anon key).
-- The files themselves stay protected by Google Drive sharing.
alter table pm_documents enable row level security;
drop policy if exists pm_documents_app_access on pm_documents;
create policy pm_documents_app_access on pm_documents
  for all to anon, authenticated using (true) with check (true);
