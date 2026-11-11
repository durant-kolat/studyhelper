-- ============================================================
-- MIGRATION V2.0 — Facturation Premium : MTN MoMo, Orange Money,
--                  Mastercard ; renouvellement ; historique
-- ============================================================
-- À exécuter UNE FOIS dans Supabase > SQL Editor, APRÈS V1.9.
-- Rejouable sans erreur. NE SUPPRIME AUCUNE donnée : les colonnes sont
-- ajoutées, les anciens abonnements Premium sont recopiés, les anciens
-- paiements « completed » sont simplement renommés « success ».
--
--   1) profiles  : premium_started_at / premium_expires_at (+ miroir de
--                  subscription_expires_at : tout le code existant continue
--                  de fonctionner sans modification)
--   2) payments  : statuts pending|success|failed|cancelled|expired,
--                  période Premium achetée, identifiant de transaction du
--                  prestataire, montant réellement payé, expiration
--   3) Activation ATOMIQUE et IDEMPOTENTE : apply_payment_success()
--      (prolonge si Premium actif, repart de la confirmation si expiré)
--   4) Anti double paiement : un seul paiement Premium « pending » par
--      utilisateur ; une transaction prestataire ne sert qu'une fois
--   5) premium_autorenew / premium_notifications (réservées au serveur)
--   6) payments n'est plus lisible depuis le navigateur (jetons du
--      prestataire) : l'application passe par /api/premium/status

-- ============================================================
-- 0) Garde-fous (au cas où la V1.9 serait incomplète)
-- ============================================================
alter table public.payments add column if not exists method text;
alter table public.payments add column if not exists activated_at timestamptz;

-- ============================================================
-- 1) PROFILES : début / expiration du Premium
-- ============================================================
alter table public.profiles add column if not exists premium_started_at timestamptz;
alter table public.profiles add column if not exists premium_expires_at timestamptz;

-- Reprise des abonnements existants (aucune donnée perdue).
update public.profiles
   set premium_expires_at = subscription_expires_at
 where premium_expires_at is null and subscription_expires_at is not null;

update public.profiles p
   set premium_started_at = s.first_paid
  from (
    select user_id, min(coalesce(activated_at, updated_at, created_at)) as first_paid
      from public.payments
     where type = 'premium' and status in ('completed', 'success') and user_id is not null
     group by user_id
  ) s
 where p.id = s.user_id and p.premium_started_at is null and p.subscription_status = 'premium';

-- Miroir bidirectionnel : premium_expires_at (nouveau nom) <-> subscription_expires_at
-- (nom historique, lu par user_is_premium(), le quota IA, les groupes, le cron…).
-- Quel que soit celui qu'on modifie, l'autre suit : jamais de divergence.
create or replace function public.sync_premium_expiry()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.premium_expires_at is null then
      new.premium_expires_at := new.subscription_expires_at;
    elsif new.subscription_expires_at is null then
      new.subscription_expires_at := new.premium_expires_at;
    end if;
  else
    if new.premium_expires_at is distinct from old.premium_expires_at then
      new.subscription_expires_at := new.premium_expires_at;
    elsif new.subscription_expires_at is distinct from old.subscription_expires_at then
      new.premium_expires_at := new.subscription_expires_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_premium_expiry on public.profiles;
create trigger profiles_sync_premium_expiry
  before insert or update on public.profiles
  for each row execute function public.sync_premium_expiry();
-- Aucun « grant update » sur les nouvelles colonnes : seul le serveur les écrit.

-- ============================================================
-- 2) PAYMENTS : statuts et colonnes de la facturation
-- ============================================================
alter table public.payments add column if not exists provider_txn_id text;      -- identifiant de transaction du prestataire
alter table public.payments add column if not exists duration_days integer;     -- durée achetée (jours), figée à la création
alter table public.payments add column if not exists period_start timestamptz;  -- début de la période achetée
alter table public.payments add column if not exists period_end timestamptz;    -- fin de la période achetée (= nouvelle expiration)
alter table public.payments add column if not exists renewal boolean not null default false; -- true = prolongation d'un Premium actif
alter table public.payments add column if not exists paid_amount integer;       -- montant réellement payé (confirmé par le prestataire)
alter table public.payments add column if not exists expires_at timestamptz;    -- fin de validité d'un paiement « pending »
alter table public.payments add column if not exists failure_reason text;

-- Statuts : pending | success | failed | cancelled | expired.
-- (l'ancienne valeur « completed » devient « success » ; l'historique est conservé)
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.payments'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.payments drop constraint %I', r.conname);
  end loop;
end $$;

update public.payments set status = 'success' where status = 'completed';
-- Un éventuel statut inconnu d'une ancienne version ne doit pas bloquer la migration :
-- il devient « failed » et l'ancienne valeur est conservée dans failure_reason.
update public.payments
   set failure_reason = coalesce(failure_reason, 'legacy_status:' || status), status = 'failed'
 where status not in ('pending', 'success', 'failed', 'cancelled', 'expired');

alter table public.payments
  add constraint payments_status_check
  check (status in ('pending', 'success', 'failed', 'cancelled', 'expired'));

-- Historique : on recopie le montant déjà confirmé et l'identifiant Monetbil.
update public.payments set paid_amount = amount where status = 'success' and paid_amount is null;
update public.payments
   set provider_txn_id = meta->>'monetbil_transaction_id'
 where provider_txn_id is null and meta->>'monetbil_transaction_id' is not null;

-- Anti double paiement (1/2) : une transaction du prestataire ne sert qu'à UN paiement.
create unique index if not exists payments_provider_txn_key
  on public.payments (provider, provider_txn_id) where provider_txn_id is not null;

-- Anti double paiement (2/2) : un seul paiement Premium « pending » par utilisateur.
-- On commence par ranger d'éventuels doublons déjà en base (on garde le plus récent).
update public.payments
   set status = 'expired', failure_reason = coalesce(failure_reason, 'superseded'), updated_at = now()
 where status = 'pending' and type = 'premium'
   and id not in (
     select distinct on (user_id) id from public.payments
      where status = 'pending' and type = 'premium'
      order by user_id, created_at desc
   );

create unique index if not exists payments_one_pending_premium_per_user
  on public.payments (user_id) where status = 'pending' and type = 'premium';

create index if not exists payments_user_created_idx on public.payments (user_id, created_at desc);
create index if not exists payments_pending_expiry_idx on public.payments (expires_at) where status = 'pending';

-- ============================================================
-- 3) ACTIVATION ATOMIQUE ET IDEMPOTENTE
-- ============================================================
-- Appelée UNIQUEMENT par le serveur (clé service_role) après vérification du
-- paiement auprès du prestataire. Dans une seule transaction :
--   * verrouille la ligne de paiement (deux appels simultanés passent l'un après l'autre) ;
--   * si le paiement est déjà activé → ne fait RIEN (aucune double prolongation) ;
--   * Premium encore actif  → PROLONGE : nouvelle expiration = expiration actuelle + durée ;
--   * Premium absent/expiré → nouvelle période : début = confirmation du paiement ;
--   * enregistre période, montant réellement payé, identifiant de transaction.
create or replace function public.apply_payment_success(
  p_payment_id uuid,
  p_meta jsonb default '{}'::jsonb,
  p_paid_amount integer default null,
  p_provider_txn_id text default null
)
returns table(
  out_applied boolean,
  out_type text,
  out_period_start timestamptz,
  out_period_end timestamptz,
  out_renewal boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_pay       public.payments%rowtype;
  v_now       timestamptz := now();
  v_term      text;
  v_cur_exp   timestamptz;
  v_cur_start timestamptz;
  v_cur_stat  text;
  v_start     timestamptz;
  v_end       timestamptz;
  v_renewal   boolean := false;
  v_booking   uuid;
  v_meta      jsonb := coalesce(p_meta, '{}'::jsonb);
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment_not_found';
  end if;

  -- Déjà activé : idempotent, on renvoie l'état existant sans rien modifier.
  if v_pay.activated_at is not null or v_pay.status = 'success' then
    return query select false, v_pay.type, v_pay.period_start, v_pay.period_end, v_pay.renewal;
    return;
  end if;

  if v_pay.type = 'premium' then
    v_term := coalesce(nullif(v_pay.plan, ''), v_pay.meta->>'term', 'mensuel');
    if v_term not in ('mensuel', 'trimestriel', 'annuel') then
      v_term := 'mensuel';
    end if;

    select coalesce(premium_expires_at, subscription_expires_at), premium_started_at, subscription_status::text
      into v_cur_exp, v_cur_start, v_cur_stat
      from public.profiles
     where id = v_pay.user_id
       for update;
    if not found then
      raise exception 'profile_not_found';
    end if;

    if v_cur_stat = 'premium' and v_cur_exp is not null and v_cur_exp > v_now then
      v_renewal := true;          -- Premium actif : on prolonge, aucun jour payé n'est perdu
      v_start   := v_cur_exp;
    else
      v_renewal   := false;       -- absent ou expiré : nouvelle période dès la confirmation
      v_start     := v_now;
      v_cur_start := v_now;
    end if;

    if v_pay.duration_days is not null and v_pay.duration_days > 0 then
      v_end := v_start + make_interval(days => v_pay.duration_days);
    else
      -- Ancien paiement (avant V2.0) sans durée en jours : mois calendaires.
      v_end := v_start + make_interval(months => case v_term when 'annuel' then 12 when 'trimestriel' then 3 else 1 end);
    end if;

    update public.profiles
       set subscription_status     = 'premium',
           subscription_term       = v_term,
           premium_started_at      = coalesce(v_cur_start, v_now),
           premium_expires_at      = v_end,
           subscription_expires_at = v_end
     where id = v_pay.user_id;

  elsif v_pay.type = 'tutoring' then
    begin
      v_booking := (v_pay.meta->>'booking_id')::uuid;
    exception when others then
      v_booking := null;
    end;
    if v_booking is not null then
      update public.tutoring_bookings set status = 'paid' where id = v_booking;
    end if;

  elsif v_pay.type = 'group_access' then
    -- Ancien paiement de groupe (avant la V1.9) confirmé après coup : argent encaissé,
    -- AUCUN accès accordé ; signalé pour traitement manuel.
    v_meta := v_meta || jsonb_build_object('legacy_group_access', true, 'needs_review', true);
  end if;

  update public.payments
     set status          = 'success',
         activated_at    = v_now,
         updated_at      = v_now,
         period_start    = case when v_pay.type = 'premium' then v_start end,
         period_end      = case when v_pay.type = 'premium' then v_end end,
         renewal         = v_renewal,
         paid_amount     = coalesce(p_paid_amount, amount),
         provider_txn_id = coalesce(p_provider_txn_id, provider_txn_id),
         failure_reason  = null,
         meta            = coalesce(meta, '{}'::jsonb) || v_meta
   where id = v_pay.id;

  return query select true, v_pay.type, v_start, v_end, v_renewal;
end;
$$;

revoke all on function public.apply_payment_success(uuid, jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.apply_payment_success(uuid, jsonb, integer, text) to service_role;

-- Compatibilité : l'ancien nom (V1.9) reste appelable et passe par la même fonction.
create or replace function public.complete_payment(p_payment_id uuid, p_meta jsonb default '{}'::jsonb)
returns table(activated boolean, payment_type text)
language sql security definer set search_path = public as $$
  select r.out_applied, r.out_type from public.apply_payment_success(p_payment_id, p_meta) r;
$$;

revoke all on function public.complete_payment(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_payment(uuid, jsonb) to service_role;

-- Les paiements « pending » dont la validité est dépassée passent à « expired »
-- (un paiement expiré reste revérifiable : si le client confirme tardivement chez
-- l'opérateur, le serveur l'active quand même — aucun argent encaissé n'est perdu).
create or replace function public.expire_stale_payments(p_user_id uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update public.payments
     set status = 'expired',
         failure_reason = coalesce(failure_reason, 'timeout'),
         updated_at = now()
   where status = 'pending'
     and expires_at is not null
     and expires_at < now()
     and (p_user_id is null or user_id = p_user_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_stale_payments(uuid) from public, anon, authenticated;
grant execute on function public.expire_stale_payments(uuid) to service_role;

-- ============================================================
-- 4) RENOUVELLEMENT AUTOMATIQUE + NOTIFICATIONS (serveur uniquement)
-- ============================================================
-- Aucune donnée sensible : jamais de PIN, de CVV ni de numéro de carte. `mandate_ref`
-- n'est qu'une référence opaque fournie PAR LE PRESTATAIRE (accord de prélèvement /
-- jeton) — et seulement si le prestataire propose officiellement ce mécanisme.
create table if not exists public.premium_autorenew (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  provider text,
  method text,
  plan text,
  mandate_ref text,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  failure_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.premium_autorenew enable row level security;
revoke all on public.premium_autorenew from anon, authenticated;

-- Une notification n'est envoyée qu'UNE fois par échéance (user, période, type).
create table if not exists public.premium_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_end timestamptz not null,
  kind text not null check (kind in ('expiring_7d', 'expiring_3d', 'expires_today', 'expired', 'autorenew_failed')),
  channel text not null default 'push',
  delivered integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, period_end, kind)
);
alter table public.premium_notifications enable row level security;
revoke all on public.premium_notifications from anon, authenticated;

-- ============================================================
-- 5) SÉCURITÉ : les paiements ne sont plus lisibles depuis le navigateur
-- ============================================================
-- (jetons de notification du prestataire, références…). L'application lit
-- l'historique via /api/premium/status, qui n'expose que des champs sûrs.
alter table public.payments enable row level security;
revoke select on public.payments from anon, authenticated;

notify pgrst, 'reload schema';

-- Vérifications rapides (à lancer après la migration) :
--   select proname from pg_proc where proname in ('apply_payment_success','expire_stale_payments','sync_premium_expiry');
--   select status, count(*) from payments group by 1;
--   select count(*) from profiles where subscription_status = 'premium' and premium_expires_at is distinct from subscription_expires_at; -- doit être 0
