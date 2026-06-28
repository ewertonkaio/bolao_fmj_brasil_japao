# Bolão Brasil x Japão — com pagamento Pix automático

Confirmação de pagamento automática via **Mercado Pago** + **Netlify Functions** + **Supabase**.
Quando alguém paga o Pix, o palpite é marcado como pago sozinho.

---

## Visão geral do fluxo

1. A pessoa preenche nome + placar e toca "Continuar para o pagamento".
2. O app chama a função `criar-pix`, que cria uma cobrança Pix no Mercado Pago e salva o palpite (pendente) no Supabase.
3. O app mostra o QR Code e o copia-e-cola gerados pelo Mercado Pago.
4. A pessoa paga. O Mercado Pago chama a função `webhook`, que confere o pagamento e marca o palpite como **pago** no Supabase.
5. O app fica checando o status e mostra "Pagamento confirmado!" sozinho.

---

## Passo 1 — Ajustar o banco (Supabase)

No **SQL Editor** do Supabase, rode (adiciona a coluna que guarda o id do pagamento):

```sql
alter table palpites add column if not exists mp_payment_id text;
alter table palpites add column if not exists chave_pix text;
```

(As tabelas `palpites` e `config` e as policies que você já criou continuam valendo.)

---

## Passo 2 — Pegar as credenciais do Mercado Pago

1. Acesse https://www.mercadopago.com.br/developers e entre com sua conta.
2. Vá em **Suas integrações** → crie uma aplicação (nome livre, ex: "Bolão").
3. Em **Credenciais de produção**, copie o **Access Token** (começa com `APP_USR-...`).
   - Use as de **produção** para receber de verdade; as de **teste** só funcionam com contas de teste.
4. Sua conta precisa ter o **Pix ativado** (cadastre uma chave Pix na conta Mercado Pago).

---

## Passo 3 — Publicar no Netlify (com GitHub)

> Netlify Drop (arrastar arquivo) **não** roda Functions. Precisa ser via GitHub ou Netlify CLI.

### Opção A — GitHub (recomendada)
1. Crie um repositório no GitHub e suba esta pasta inteira (`bolao/`).
2. No Netlify: **Add new site → Import an existing project → GitHub** e escolha o repositório.
3. Build settings: deixe como está (o `netlify.toml` já define tudo). Clique em **Deploy**.

### Opção B — Netlify CLI
```bash
npm i -g netlify-cli
cd bolao
netlify deploy --prod
```

---

## Passo 4 — Configurar as variáveis de ambiente no Netlify

No painel do site: **Site configuration → Environment variables → Add a variable**. Crie estas 4:

| Nome | Valor |
|------|-------|
| `MP_ACCESS_TOKEN` | seu Access Token de produção do Mercado Pago (`APP_USR-...`) |
| `SUPABASE_URL` | `https://zukiviolneukiqjjvakk.supabase.co` |
| `SUPABASE_KEY` | a chave **service_role** do Supabase (Settings → API). **NÃO** a anon. |
| `PIX_AMOUNT` | `5` |

Depois de salvar, faça um **redeploy** (Deploys → Trigger deploy) pra valer.

> Por que service_role aqui? As functions rodam no servidor e precisam marcar pagamento mesmo que as policies públicas não permitam. Essa chave fica só no Netlify, nunca no navegador.

---

## Passo 5 — Apontar o webhook do Mercado Pago

1. No painel do Mercado Pago (sua aplicação) → **Webhooks / Notificações**.
2. Em URL de produção, coloque:
   ```
   https://SEU-SITE.netlify.app/.netlify/functions/webhook
   ```
3. Marque o evento **Pagamentos** (payment).
4. Salve.

---

## Passo 6 — Testar

1. Abra o site, faça um palpite e gere o Pix.
2. Pague (pode ser um valor real de R$ 5; depois você se reembolsa, ou teste com conta de teste do MP).
3. Em alguns segundos o app deve mostrar "Pagamento confirmado!" e o palpite aparece como ✓ Pago.

Se não confirmar:
- Veja os logs em **Netlify → Functions → webhook** (mostra se o MP chamou).
- Confirme que o webhook está na URL certa e que o Access Token é de produção.
- Confirme que a coluna `mp_payment_id` foi criada e que `SUPABASE_KEY` é a service_role.

---

## Observações

- **Um palpite por pessoa:** cada nome só pode registrar um palpite. Depois que o pagamento é confirmado, aquele nome fica travado e não consegue palpitar de novo (a trava vale no app e também no servidor, então não dá pra burlar). Se a pessoa fechou antes de pagar, ao voltar com o mesmo nome ela reaproveita a mesma cobrança Pix em vez de gerar outra.
- O painel de premiação (90% ganhadores / 10% admin) e a senha do organizador continuam iguais.
- O valor `PIX_AMOUNT` aparece em dois lugares: na variável de ambiente (servidor) e no topo do `public/index.html` (só pro cálculo do prêmio). Mantenha os dois iguais.
- Taxas: o Mercado Pago cobra uma pequena taxa por recebimento via Pix. Considere isso na hora de fechar as contas do bolão.
