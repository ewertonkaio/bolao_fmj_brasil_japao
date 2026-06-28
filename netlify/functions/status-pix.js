// Consulta o status de um pagamento (usado pelo app pra saber se já foi pago).
// Lê do Supabase (que o webhook atualiza). Variáveis: SUPABASE_URL, SUPABASE_KEY.

exports.handler = async (event) => {
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_KEY;
  const nome_key = ((event.queryStringParameters || {}).nome_key || '').toLowerCase();
  if (!nome_key) return json(400, { error: 'nome_key obrigatório' });

  try {
    const r = await fetch(
      SB_URL + '/rest/v1/palpites?nome_key=eq.' + encodeURIComponent(nome_key) + '&select=pago',
      { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
    );
    const rows = await r.json();
    const pago = rows.length ? !!rows[0].pago : false;
    return json(200, { pago });
  } catch (e) {
    return json(500, { error: String(e) });
  }
};

function json(code, obj) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj)
  };
}
