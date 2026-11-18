-- Sprint 2A.1 — integridade do catálogo legal no próprio banco (última linha de defesa).
-- O backend já aplica estas regras; os triggers garantem que nenhum caminho
-- (bug, script, acesso direto) apague evidências ou reescreva conteúdo.
--   * DELETE é proibido em todas as tabelas do catálogo.
--   * Conteúdo de fonte, snapshot, dispositivo, regra, versão e trilha é imutável;
--     só mudam colunas de ciclo de vida (licença da fonte, encerramento de efeitos,
--     status/encerramento da versão).
--   * Mudança de status de versão exige linha correspondente em tax_rule_approvals
--     gravada na MESMA transação (decided_at = now(), o instante da transação).
--   * Dispositivos de uma versão só são gravados na transação que cria a versão.
-- Mensagens começam com "catalogo:" para facilitar diagnóstico.

CREATE FUNCTION catalogo_bloqueia_exclusao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'catalogo: exclusão proibida em % (histórico append-only)', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION catalogo_bloqueia_alteracao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'catalogo: alteração proibida em % (registro imutável)', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION catalogo_fonte_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['license_status', 'license_reference', 'license_updated_by', 'license_updated_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['license_status', 'license_reference', 'license_updated_by', 'license_updated_at']) THEN
    RAISE EXCEPTION 'catalogo: só a situação de licença de uma fonte pode ser alterada';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION catalogo_dispositivo_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['effects_to', 'effects_closed_by', 'effects_closed_at', 'effects_closed_reason'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['effects_to', 'effects_closed_by', 'effects_closed_at', 'effects_closed_reason']) THEN
    RAISE EXCEPTION 'catalogo: conteúdo de dispositivo legal é imutável';
  END IF;
  IF OLD.effects_closed_at IS NOT NULL OR NEW.effects_closed_at IS NULL OR NEW.effects_to IS NULL
     OR (OLD.effects_to IS NOT NULL AND NEW.effects_to > OLD.effects_to) THEN
    RAISE EXCEPTION 'catalogo: encerramento de efeitos só uma vez, com data, sem ampliar a vigência';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION catalogo_versao_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'RASCUNHO' OR NEW.superseded_by_version_id IS NOT NULL OR NEW.effects_ended_on IS NOT NULL THEN
    RAISE EXCEPTION 'catalogo: versão nasce como RASCUNHO, sem substituição nem encerramento';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION catalogo_versao_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'status_changed_at', 'superseded_by_version_id', 'effects_ended_on'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'status_changed_at', 'superseded_by_version_id', 'effects_ended_on']) THEN
    RAISE EXCEPTION 'catalogo: conteúdo de versão de regra é imutável; crie nova versão';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (
      SELECT 1 FROM tax_rule_approvals a
      WHERE a.rule_version_id = NEW.id AND a.from_status = OLD.status AND a.to_status = NEW.status AND a.decided_at = now()
    ) THEN
      RAISE EXCEPTION 'catalogo: mudança de status % -> % sem registro na trilha do workflow', OLD.status, NEW.status;
    END IF;
  ELSIF NEW.superseded_by_version_id IS DISTINCT FROM OLD.superseded_by_version_id OR NEW.effects_ended_on IS DISTINCT FROM OLD.effects_ended_on THEN
    RAISE EXCEPTION 'catalogo: encerramento de versão só acompanha mudança de status';
  END IF;
  IF OLD.superseded_by_version_id IS NOT NULL AND NEW.superseded_by_version_id IS DISTINCT FROM OLD.superseded_by_version_id THEN
    RAISE EXCEPTION 'catalogo: substituição já registrada não pode ser alterada';
  END IF;
  IF NEW.superseded_by_version_id IS NOT NULL AND NEW.status <> 'SUBSTITUIDA' THEN
    RAISE EXCEPTION 'catalogo: só versão SUBSTITUIDA aponta a substituta';
  END IF;
  IF OLD.effects_ended_on IS NOT NULL AND NEW.effects_ended_on IS DISTINCT FROM OLD.effects_ended_on THEN
    RAISE EXCEPTION 'catalogo: encerramento de vigência já registrado não pode ser alterado';
  END IF;
  IF NEW.effects_ended_on IS NOT NULL AND OLD.effects_ended_on IS NULL AND NEW.status NOT IN ('SUBSTITUIDA', 'REVOGADA') THEN
    RAISE EXCEPTION 'catalogo: encerramento de vigência só por substituição ou revogação';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION catalogo_vinculo_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tax_rule_versions v
    WHERE v.id = NEW.rule_version_id AND v.status = 'RASCUNHO' AND v.created_at = now()
  ) THEN
    RAISE EXCEPTION 'catalogo: dispositivos só podem ser vinculados na criação da versão';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION catalogo_trilha_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  atual tax_rule_version_status;
BEGIN
  -- O instante da decisão é sempre o da transação no servidor, nunca informado pelo cliente.
  NEW.decided_at := now();
  SELECT status INTO atual FROM tax_rule_versions WHERE id = NEW.rule_version_id;
  IF atual IS DISTINCT FROM NEW.from_status THEN
    RAISE EXCEPTION 'catalogo: trilha parte de % mas a versão está em %', NEW.from_status, atual;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER legal_sources_no_delete BEFORE DELETE ON legal_sources FOR EACH ROW EXECUTE FUNCTION catalogo_bloqueia_exclusao();
--> statement-breakpoint
CREATE TRIGGER legal_sources_update BEFORE UPDATE ON legal_sources FOR EACH ROW EXECUTE FUNCTION catalogo_fonte_update();
--> statement-breakpoint
CREATE TRIGGER legal_source_snapshots_no_delete BEFORE DELETE ON legal_source_snapshots FOR EACH ROW EXECUTE FUNCTION catalogo_bloqueia_exclusao();
--> statement-breakpoint
CREATE TRIGGER legal_source_snapshots_no_update BEFORE UPDATE ON legal_source_snapshots FOR EACH ROW EXECUTE FUNCTION catalogo_bloqueia_alteracao();
--> statement-breakpoint
CREATE TRIGGER legal_provisions_no_delete BEFORE DELETE ON legal_provisions FOR EACH ROW EXECUTE FUNCTION catalogo_bloqueia_exclusao();
--> statement-breakpoint
CREATE TRIGGER legal_provisions_update BEFORE UPDATE ON legal_provisions FOR EACH ROW EXECUTE FUNCTION catalogo_dispositivo_update();
--> statement-breakpoint
CREATE TRIGGER tax_rules_no_delete BEFORE DELETE ON tax_rules FOR EACH ROW EXECUTE FUNCTION catalogo_bloqueia_exclusao();
--> statement-breakpoint
CREATE TRIGGER tax_rules_no_update BEFORE UPDATE ON tax_rules FOR EACH ROW EXECUTE FUNCTION catalogo_bloqueia_alteracao();
--> statement-breakpoint
CREATE TRIGGER tax_rule_versions_no_delete BEFORE DELETE ON tax_rule_versions FOR EACH ROW EXECUTE FUNCTION catalogo_bloqueia_exclusao();
--> statement-breakpoint
CREATE TRIGGER tax_rule_versions_insert BEFORE INSERT ON tax_rule_versions FOR EACH ROW EXECUTE FUNCTION catalogo_versao_insert();
--> statement-breakpoint
CREATE TRIGGER tax_rule_versions_update BEFORE UPDATE ON tax_rule_versions FOR EACH ROW EXECUTE FUNCTION catalogo_versao_update();
--> statement-breakpoint
CREATE TRIGGER tax_rule_version_provisions_no_delete BEFORE DELETE ON tax_rule_version_provisions FOR EACH ROW EXECUTE FUNCTION catalogo_bloqueia_exclusao();
--> statement-breakpoint
CREATE TRIGGER tax_rule_version_provisions_no_update BEFORE UPDATE ON tax_rule_version_provisions FOR EACH ROW EXECUTE FUNCTION catalogo_bloqueia_alteracao();
--> statement-breakpoint
CREATE TRIGGER tax_rule_version_provisions_insert BEFORE INSERT ON tax_rule_version_provisions FOR EACH ROW EXECUTE FUNCTION catalogo_vinculo_insert();
--> statement-breakpoint
CREATE TRIGGER tax_rule_approvals_no_delete BEFORE DELETE ON tax_rule_approvals FOR EACH ROW EXECUTE FUNCTION catalogo_bloqueia_exclusao();
--> statement-breakpoint
CREATE TRIGGER tax_rule_approvals_no_update BEFORE UPDATE ON tax_rule_approvals FOR EACH ROW EXECUTE FUNCTION catalogo_bloqueia_alteracao();
--> statement-breakpoint
CREATE TRIGGER tax_rule_approvals_insert BEFORE INSERT ON tax_rule_approvals FOR EACH ROW EXECUTE FUNCTION catalogo_trilha_insert();
