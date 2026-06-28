// Cria uma cobrança Pix no Mercado Pago e grava o palpite (pendente) no Supabase.
// Variáveis de ambiente necessárias (Netlify → Site settings → Environment variables):
//   MP_ACCESS_TOKEN   -> Access Token de PRODUÇÃO do Mercado Pago
//   SUPABASE_URL      -> ex: https://xxxx.supabase.co
//   SUPABASE_KEY      -> chave service_role (NÃO a anon) — fica só no servidor
//   PIX_AMOUNT        -> valor da entrada, ex: 5.00 (opcional, padrão 5)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
  const SB_URL   = process.env.SUPABASE_URL;
  const SB_KEY   = process.env.SUPABASE_KEY;
  const AMOUNT   = Number(process.env.PIX_AMOUNT || '5');

  if (!MP_TOKEN || !SB_URL || !SB_KEY) {
    return json(500, { error: 'Servidor sem configuração. Faltam variáveis de ambiente.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON inválido' }); }

  const nome = (body.nome || '').trim();
  const br = parseInt(body.br, 10);
  const jp = parseInt(body.jp, 10);
  if (!nome || isNaN(br) || isNaN(jp)) return json(400, { error: 'Dados incompletos' });

  const nome_key = nome.toLowerCase();
  const ts = Date.now();

  try {
    // 0) trava: um palpite por nome. Se já existe, decide se pode ou não criar nova cobrança.
    const chkRes = await fetch(
      SB_URL + '/rest/v1/palpites?nome_key=eq.' + encodeURIComponent(nome_key) + '&select=pago,mp_payment_id',
      { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
    );
    if (chkRes.ok) {
      const ex = await chkRes.json();
      if (ex.length) {
        // já pagou -> bloqueia de vez
        if (ex[0].pago) {
          return json(409, { error: 'ja_existe', message: 'Esse nome já tem um palpite confirmado. Use outro nome.' });
        }
        // existe mas ainda não pagou: reaproveita a cobrança Pix anterior (não cria outra)
        if (ex[0].mp_payment_id) {
          try {
            const old = await fetch('https://api.mercadopago.com/v1/payments/' + ex[0].mp_payment_id, {
              headers: { 'Authorization': 'Bearer ' + MP_TOKEN }
            });
            if (old.ok) {
              const op = await old.json();
              const otx = op.point_of_interaction && op.point_of_interaction.transaction_data;
              if (op.status === 'pending' && otx) {
                return json(200, {
                  payment_id: op.id, qr_code: otx.qr_code,
                  qr_code_base64: otx.qr_code_base64, ticket_url: otx.ticket_url || null, reused: true
                });
              }
            }
          } catch (e) { /* se falhar, segue e cria uma nova abaixo */ }
        }
      }
    }

    // 1) cria a cobrança Pix no Mercado Pago
    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + MP_TOKEN,
        'X-Idempotency-Key': nome_key + '-' + ts
      },
      body: JSON.stringify({
        transaction_amount: AMOUNT,
        description: 'Bolão Brasil x Japão — ' + nome,
        payment_method_id: 'pix',
        external_reference: nome_key,
        payer: { email: sanitizeEmail(nome_key) + '@bolao.local', first_name: nome.substring(0, 40) }
      })
    });
    const mp = await mpRes.json();
    if (!mpRes.ok) {
      return json(502, { error: 'Mercado Pago recusou', detail: mp });
    }
    const tx = mp.point_of_interaction && mp.point_of_interaction.transaction_data;
    if (!tx) return json(502, { error: 'Resposta do MP sem dados de Pix' });

    // 2) grava/atualiza o palpite no Supabase (pendente, guardando o id do pagamento)
    const upRes = await fetch(SB_URL + '/rest/v1/palpites?on_conflict=nome_key', {
      method: 'POST',
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify([{ nome_key, nome, br, jp, pago: false, ts, mp_payment_id: String(mp.id) }])
    });
    if (!upRes.ok) {
      const t = await upRes.text();
      return json(502, { error: 'Falha ao salvar no Supabase', detail: t });
    }

    // 3) devolve QR pro frontend
    return json(200, {
      payment_id: mp.id,
      qr_code: tx.qr_code,                 // copia-e-cola
      qr_code_base64: tx.qr_code_base64,   // imagem PNG em base64
      ticket_url: tx.ticket_url || null
    });
  } catch (e) {
    return json(500, { error: 'Erro inesperado', detail: String(e) });
  }
};

function json(code, obj) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj)
  };
}
function sanitizeEmail(s) { return s.replace(/[^a-z0-9]/g, '') || 'palpiteiro'; }
