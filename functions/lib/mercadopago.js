const { MercadoPagoConfig, Payment } = require('mercadopago');

function client() {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) throw new Error('MP_ACCESS_TOKEN não configurado nas variáveis de ambiente da function.');
  return new MercadoPagoConfig({ accessToken });
}

async function criarPagamentoPix({ total, email, nomePagador, descricao, externalReference }) {
  const payment = new Payment(client());
  return payment.create({
    body: {
      transaction_amount: Math.round(total * 100) / 100,
      description: descricao,
      payment_method_id: 'pix',
      payer: { email, first_name: nomePagador || 'Responsável' },
      external_reference: externalReference,
    },
  });
}

async function buscarPagamento(paymentId) {
  const payment = new Payment(client());
  return payment.get({ id: paymentId });
}

module.exports = { criarPagamentoPix, buscarPagamento };
