// Cria uma cobrança Pix no Mercado Pago e grava o palpite (pendente) no Supabase.
// Variáveis de ambiente (Netlify → Site settings → Environment variables):
//   MP_ACCESS_TOKEN  -> Access Token de PRODUÇÃO do Mercado Pago (APP_USR-...)
//   SUPABASE_URL     -> https://xxxx.supabase.co
//   SUPABASE_KEY     -> chave service_role do Supabase
//   PIX_AMOUNT       -> valor da entrada (opcional, padrão 5)

exports.handler = async (event) => {
  console.log('criar-pix: início', event.httpMethod);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
  const SB_URL   = process.env.SUPABASE_URL;
  const SB_KEY   = process.env.SUPABASE_KEY;
  const AMOUNT   = Number(process.env.PIX_AMOUNT || '5');

  if (!MP_TOKEN || !SB_URL || !SB_KEY) {
    console.error('criar-pix: faltam variáveis', { temToken: !!MP_TOKEN, temUrl: !!SB_URL, temKey: !!SB_KEY });
    return json(500, { error: 'Servidor sem configuração. Faltam variáveis de ambiente.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'JSON inválido' }); }

  const nome = (body.nome || '').trim();
  const chave_pix = (body.chave_pix || '').trim();
  const br = parseInt(body.br, 10);
  const jp = parseInt(body.jp, 10);
  if (!nome || isNaN(br) || isNaN(jp)) return json(400, { error: 'Dados incompletos' });

  const nome_key = nome.toLowerCase();
  const ts = Date.now();

  try {
    // 0) trava: um palpite por nome
    console.log('criar-pix: checando nome', nome_key);
    const chkRes = await fetch(
      SB_URL + '/rest/v1/palpites?nome_key=eq.' + encodeURIComponent(nome_key) + '&select=pago,mp_payment_id',
      { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
    );
    if (chkRes.ok) {
      const ex = await chkRes.json();
      if (ex.length && ex[0].pago) {
        return json(409, { error: 'ja_existe', message: 'Esse nome já tem um palpite confirmado. Use outro nome.' });
      }
    } else {
      console.error('criar-pix: erro ao checar nome', chkRes.status, await safeText(chkRes));
    }

    // 1) cria a cobrança Pix no Mercado Pago
    console.log('criar-pix: criando pagamento MP, valor', AMOUNT);
    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + MP_TOKEN,
        'X-Idempotency-Key': nome_key + '-' + ts
      },
      body: JSON.stringify({
        transaction_amount: AMOUNT,
        description: 'Bolao Brasil x Japao - ' + nome,
        payment_method_id: 'pix',
        external_reference: nome_key,
        payer: { email: sanitizeEmail(nome_key) + '@gmail.com' }
      })
    });
    const mpText = await safeText(mpRes);
    let mp;
    try { mp = JSON.parse(mpText); } catch (e) { mp = {}; }
    console.log('criar-pix: MP status', mpRes.status);

    if (!mpRes.ok) {
      console.error('criar-pix: MP recusou', mpRes.status, mpText);
      return json(502, { error: 'Mercado Pago recusou', status: mpRes.status, detail: mp });
    }
    const tx = mp.point_of_interaction && mp.point_of_interaction.transaction_data;
    if (!tx) {
      console.error('criar-pix: MP sem transaction_data', mpText);
      return json(502, { error: 'Resposta do MP sem dados de Pix' });
    }

    // 2) grava/atualiza o palpite no Supabase
    console.log('criar-pix: salvando no Supabase');
    const upRes = await fetch(SB_URL + '/rest/v1/palpites?on_conflict=nome_key', {
      method: 'POST',
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify([{ nome_key, nome, br, jp, pago: false, ts, mp_payment_id: String(mp.id), chave_pix }])
    });
    if (!upRes.ok) {
      const t = await safeText(upRes);
      console.error('criar-pix: falha Supabase', upRes.status, t);
      return json(502, { error: 'Falha ao salvar no Supabase', detail: t });
    }

    console.log('criar-pix: sucesso, payment', mp.id);
    return json(200, {
      payment_id: mp.id,
      qr_code: tx.qr_code,
      qr_code_base64: tx.qr_code_base64,
      ticket_url: tx.ticket_url || null
    });
  } catch (e) {
    console.error('criar-pix: exceção', String(e), e && e.stack);
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
async function safeText(res) { try { return await res.text(); } catch (e) { return ''; } }
function sanitizeEmail(s) { return (s.replace(/[^a-z0-9]/g, '') || 'palpiteiro').substring(0, 30); }
