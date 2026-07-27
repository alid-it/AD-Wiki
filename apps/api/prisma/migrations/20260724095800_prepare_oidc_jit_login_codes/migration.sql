-- OIDC-Einmalcodes sind maximal 60 Sekunden gültig und werden bei einem
-- Deployment bewusst verworfen. Dadurch kann die nachfolgende Migration die
-- Identitätsbindung als Pflichtfeld ergänzen, ohne alte Klartextwerte oder
-- unsichere Zuordnungen zu übernehmen.
DELETE FROM "oidc_login_codes";
