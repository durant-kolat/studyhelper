-- Study Helper v3.3 — Paiements directs MTN / Orange et PayPal (en plus de l'historique CamPay / Lygos / Monetbil).
-- ADDITIVE et sans risque : aucune table recréée, aucune donnée modifiée. La colonne payments.provider est un texte libre :
-- 'mtn', 'orange' et 'paypal' s'y ajoutent sans modification de schéma. apply_payment_success() reste LA référence d'activation Premium.
-- PRÉREQUIS : migrations v1.8 à v2.1 (colonnes provider, provider_ref, provider_txn_id, meta). Défensif : si une colonne manque, l'index
-- correspondant est simplement ignoré (aucune erreur) ; rejoue cette migration après avoir exécuté les migrations manquantes.

do $$
begin
  -- Rapprochement des notifications Orange (elles ne contiennent que notif_token) : index d'expression sur le jeton.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'meta')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'provider') then
    execute 'create index if not exists payments_orange_notif_token_idx on public.payments ((meta->>''orange_notif_token'')) where provider = ''orange''';
  else
    raise notice 'v3.3 : colonnes meta/provider absentes de payments — exécute d''abord les migrations v1.8 à v2.1, puis rejoue celle-ci.';
  end if;

  -- Un même identifiant de transaction ne sert jamais deux paiements du même prestataire (créé par v2.0 / v2.1 ; rappel idempotent).
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'provider_txn_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'provider') then
    execute 'create unique index if not exists payments_provider_txn_key on public.payments (provider, provider_txn_id) where provider_txn_id is not null';
  else
    raise notice 'v3.3 : provider_txn_id absente — la migration v2.0 (facturation Premium) n''a pas encore été exécutée.';
  end if;
end $$;
