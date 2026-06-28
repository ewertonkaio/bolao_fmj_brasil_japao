// Recebe a notificação do Mercado Pago quando um pagamento muda de status.
// Confere o pagamento direto na API do MP (fonte da verdade) e, se aprovado,
// marca o palpite correspondente como pago no Supabase.
//
// Variáveis de ambiente: MP_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_KEY (service_role)

exports.handler = async (event) => {
  const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
  const SB_URL   = process.env.SUPABASE_URL;
  const SB_KEY   = process.env.SUPABASE_KEY;

  // o MP envia o id do pagamento via querystring (?id=...&topic=payment) ou no corpo
  let paymentId = null;
  try {
    const q = event.queryStringParameters || {};
    if (q['data.id']) paymentId = q['data.id'];
    else if (q.id && (q.topic === 'payment' || q.type === 'payment')) paymentId = q.id;
    if (!paymentId && event.body) {
      const b = JSON.parse(event.body);
      if (b.data && b.data.id) paymentId = b.data.id;
      else if (b.id && (b.type === 'payment' || b.topic === 'payment')) paymentId = b.id;
    }
  } catch { /* ignora corpo inválido */ }

  // sempre responde 200 rápido pro MP não reenviar; se não há id, nada a fazer
  if (!paymentId) return { statusCode: 200, body: 'ok' };

  try {
    // 1) consulta o pagamento na API do MP (não confiamos só na notificação)
    const r = await fetch('https://api.mercadopago.com/v1/payments/' + paymentId, {
      headers: { 'Authorization': 'Bearer ' + MP_TOKEN }
    });
    if (!r.ok) return { statusCode: 200, body: 'ok' };
    const pay = await r.json();

    if (pay.status === 'approved') {
      const nome_key = (pay.external_reference || '').toLowerCase();
      if (nome_key) {
        // 2) marca como pago no Supabase
        await fetch(SB_URL + '/rest/v1/palpites?nome_key=eq.' + encodeURIComponent(nome_key), {
          method: 'PATCH',
          headers: {
            'apikey': SB_KEY,
            'Authorization': 'Bearer ' + SB_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ pago: true })
        });
      }
    }
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    return { statusCode: 200, body: 'ok' };
  }
};
