# Certificados de banco

`supabase-prod-ca-2021.crt` é a CA pública do PostgreSQL hospedado do Supabase,
obtida de:

`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`

Configure `DATABASE_SSL_CA_PATH=config/certs/supabase-prod-ca-2021.crt` e mantenha
`DATABASE_SSL_REJECT_UNAUTHORIZED=true`. Antes de uma rotação anunciada pelo
provedor ou da expiração do certificado, substitua o arquivo pela CA exibida em
**Supabase Dashboard > Database Settings > SSL Configuration** e valide a cadeia
em homologação.
