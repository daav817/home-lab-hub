import { sql } from "./db";

// Applied once each, in order. Add new migrations to the end; never edit an old one.
const migrations = [
  `create table apps (
     id uuid primary key default gen_random_uuid(),
     name text not null unique,
     description text not null default '',
     url text not null,
     status_url text,
     category text not null,
     audience text not null check (audience in ('everyone', 'family', 'admin')),
     hidden boolean not null default false,
     sort_order integer not null default 100,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   )`,
  `create table audit_log (
     id bigint generated always as identity primary key,
     at timestamptz not null default now(),
     actor text not null,
     action text not null,
     target text not null,
     detail jsonb
   )`,
  `insert into apps (name, description, url, status_url, category, audience, sort_order) values
     ('CRM', 'Customer records', 'https://crm.energiapower.llc', 'http://energia.default.svc.cluster.local', 'Business', 'family', 10),
     ('PDF Edit', 'Edit and sign PDFs', 'https://pdf-edit.energiapower.llc', 'http://pdf-edit.pdf-edit.svc.cluster.local/api/health', 'Business', 'family', 20),
     ('Investco', 'Investment tracking', 'https://investco.energiapower.llc', 'http://investco.investco.svc.cluster.local', 'Business', 'family', 30),
     ('Godseye', 'Godseye', 'https://godseye.energiapower.llc', 'http://godseye.godseye.svc.cluster.local', 'Business', 'family', 40),
     ('Petros AI', 'Home network only', 'http://192.168.1.240', 'http://petros-ai-engine.default.svc.cluster.local', 'Business', 'family', 50),
     ('Energia Website', 'Public business site', 'https://www.energiapower.llc', 'http://energia-website.energia-web.svc.cluster.local', 'Business', 'family', 60),
     ('ArgoCD', 'Deployments. Home network only', 'https://argocd.192.168.1.243.nip.io', 'http://argocd-server.argocd.svc.cluster.local/healthz', 'Admin', 'admin', 70),
     ('Grafana', 'Cluster dashboards', 'https://grafana.energiapower.llc', 'http://kube-prometheus-stack-grafana.monitoring.svc.cluster.local/api/health', 'Admin', 'admin', 80),
     ('Authentik', 'Users, invites and login settings', 'https://auth.energiapower.llc', 'http://authentik-server.authentik.svc.cluster.local/-/health/live/', 'Admin', 'admin', 90)`,
  // Camera clips saved to the router (clip keeper). Status checks the keeper's health endpoint.
  `insert into apps (name, description, url, status_url, category, audience, sort_order) values
     ('Recordings', 'Camera clips: play, group, delete', 'https://hub.energiapower.llc/recordings',
      'http://clip-keeper.cameras.svc.cluster.local:8080/healthz', 'Home', 'family', 110)
   on conflict (name) do nothing`,
  // Router shares (Phase 6). The hub serves them itself, so it has no separate status check.
  `insert into apps (name, description, url, status_url, category, audience, sort_order) values
     ('Files', 'Router drives: photos, videos, music and shared files', 'https://hub.energiapower.llc/files',
      null, 'Home', 'family', 120)
   on conflict (name) do nothing`,
  // Router files deleted through the hub wait in <share>/.hub-trash/<id>/ (src/lib/trash.ts).
  `create table file_trash (
     id text primary key,
     share text not null,
     original text not null,
     is_dir boolean not null,
     size bigint not null default 0,
     deleted_by text not null,
     deleted_at timestamptz not null default now()
   )`,
  // Small hub settings changed from the UI (organizer's nightly schedule, ...).
  `create table settings (
     key text primary key,
     value jsonb not null,
     updated_at timestamptz not null default now()
   )`,
  // Runs of the upload-folder organizer (src/lib/organizer.ts).
  `create table organize_runs (
     id bigint generated always as identity primary key,
     trigger text not null,
     actor text not null,
     status text not null,
     total integer not null default 0,
     moved integer not null default 0,
     moved_bytes bigint not null default 0,
     detail jsonb,
     started_at timestamptz not null default now(),
     finished_at timestamptz
   )`,
  // Home PCs for Wake-on-LAN (Manage > Computers, src/lib/computers.ts).
  `create table computers (
     id uuid primary key default gen_random_uuid(),
     name text not null unique,
     mac text not null unique,
     note text not null default '',
     created_at timestamptz not null default now()
   )`,
  // Remote desktop (Phase 5): MeshCentral, admins only.
  `insert into apps (name, description, url, status_url, category, audience, sort_order) values
     ('Remote desktop', 'Open the home PCs from anywhere (2FA each time)', 'https://mesh.energiapower.llc',
      'http://meshcentral.remote-access.svc.cluster.local:8080/health.ashx', 'Admin', 'admin', 95)
   on conflict (name) do nothing`,
  // Backup of photo/video/music to the second router drive (src/lib/mirror.ts).
  `create table mirror_runs (
     id bigint generated always as identity primary key,
     trigger text not null,
     actor text not null,
     status text not null,
     copied integer not null default 0,
     copied_bytes bigint not null default 0,
     errors integer not null default 0,
     detail jsonb,
     started_at timestamptz not null default now(),
     finished_at timestamptz
   )`,
  // Files on the backup that are no longer on the main drive: deleted only after an admin
  // confirms them (Files page).
  `create table mirror_pending (
     share text not null,
     path text not null,
     size bigint not null default 0,
     found_at timestamptz not null default now(),
     primary key (share, path)
   )`,
];

export async function migrate() {
  await sql.begin(async (tx) => {
    // Stops two pods starting at once from running the same migration.
    await tx`select pg_advisory_xact_lock(727274)`;
    await tx`create table if not exists schema_migrations (version integer primary key)`;
    const [{ version }] = await tx<{ version: number }[]>`
      select coalesce(max(version), 0) as version from schema_migrations
    `;
    for (const [index, statement] of migrations.entries()) {
      if (index < version) continue;
      await tx.unsafe(statement);
      await tx`insert into schema_migrations (version) values (${index + 1})`;
    }
  });
}
