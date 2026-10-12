-- New-bond registration tracking (KSEI new-securities alert dedup).
-- One row per KSEI registration announcement we've seen; the ref no is the
-- stable unique key. coupon_pct is the max tranche coupon read from the PDF
-- (null when unreadable or when seeded on first run).

create table if not exists public.bond_registrations (
    ref           text primary key,          -- KSEI-####/DIR/mmyy
    title         text not null,
    kind          text not null,             -- OBLIGASI | SUKUK | NCD
    registered_at date,
    coupon_pct    numeric,
    pdf_url       text,
    seen_at       timestamptz not null default now()
);

insert into public.schema_migrations (version, name) values ('050', '050_bond_registrations') on conflict do nothing;
