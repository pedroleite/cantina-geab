const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');

const { db, kvGet, kvSet, kvListWithValues } = require('./lib/db');
const { todayKeyBR } = require('./lib/dia');
const { criarPagamentoPix, buscarPagamento } = require('./lib/mercadopago');

setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

const DEFAULT_STOCK_QTY = 50;
const CORS_ORIGINS = true; // TODO: trocar por lista de domínios (ex.: ['https://www.geab13.com.br']) antes de ir pra produção
const MP_SECRETS = ['MP_ACCESS_TOKEN']; // precisa estar declarado aqui pra virar process.env.MP_ACCESS_TOKEN em runtime

// ---------- helpers compartilhados ----------

async function carregarCatalogo() {
  return (await kvGet('catalogo_produtos')) || [];
}

async function carregarMembros() {
  const [base, extra] = await Promise.all([
    kvListWithValues('membro_base:'),
    kvListWithValues('membro_extra:'),
  ]);
  return base.concat(extra).map(({ value: m }) => ({
    nome: m.nome, ramo: m.ramo || 'Visitante / familiar',
    responsavel: m.responsavel || '', celular: m.celular || '',
  }));
}

function encontrarMembro(membros, nome) {
  const alvo = String(nome || '').trim().toUpperCase();
  return membros.find(m => m.nome.toUpperCase() === alvo) || null;
}

async function carregarTaxaServico() {
  // {tipo:'fixo', valor:0.5} ou {tipo:'percentual', valor:0.02} — configurável depois pelo app.
  return (await kvGet('loja_taxa_servico')) || { tipo: 'fixo', valor: 0 };
}

function calcularTaxa(subtotal, taxa) {
  if (!taxa || !taxa.valor) return 0;
  if (taxa.tipo === 'percentual') return Math.round(subtotal * taxa.valor * 100) / 100;
  return Math.round(taxa.valor * 100) / 100;
}

function gerarCompraId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function send(res, status, body) {
  res.status(status).json(body);
}

// ---------- 1. catálogo público (sem custo) ----------

exports.listarCatalogoLoja = onRequest({ cors: CORS_ORIGINS }, async (req, res) => {
  try {
    const [catalogo, taxaServico] = await Promise.all([carregarCatalogo(), carregarTaxaServico()]);
    send(res, 200, {
      produtos: catalogo.map(p => ({ id: p.id, name: p.name, price: p.price })),
      taxaServico,
    });
  } catch (e) {
    logger.error('listarCatalogoLoja', e);
    send(res, 500, { erro: 'Não foi possível carregar o catálogo.' });
  }
});

// ---------- 2. busca de nome na lista de membros (autocomplete) ----------

exports.buscarNomes = onRequest({ cors: CORS_ORIGINS }, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toUpperCase();
    if (q.length < 2) return send(res, 200, []);
    const membros = await carregarMembros();
    const achados = membros
      .filter(m => m.nome.toUpperCase().includes(q))
      .slice(0, 8)
      .map(m => ({ nome: m.nome, ramo: m.ramo }));
    send(res, 200, achados);
  } catch (e) {
    logger.error('buscarNomes', e);
    send(res, 500, { erro: 'Não foi possível buscar o nome.' });
  }
});

// ---------- 3. criar cobrança Pix ----------

exports.criarPagamentoLoja = onRequest({ cors: CORS_ORIGINS, secrets: MP_SECRETS }, async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { erro: 'Use POST.' });
  try {
    const body = req.body || {};
    const itensPedido = Array.isArray(body.itens) ? body.itens : [];
    const beneficiario = String(body.beneficiario || '').trim();
    const email = String(body.email || '').trim();
    const responsavelFallback = String(body.responsavelFallback || '').trim();
    const celularFallback = String(body.celularFallback || '').trim();

    if (!beneficiario) return send(res, 400, { erro: 'Informe o nome da criança.' });
    if (!email || !email.includes('@')) return send(res, 400, { erro: 'Informe um e-mail válido pra receber a confirmação.' });
    if (!itensPedido.length || itensPedido.length > 20) return send(res, 400, { erro: 'Pedido inválido.' });

    const catalogo = await carregarCatalogo();
    const itens = [];
    let subtotal = 0;
    for (const it of itensPedido) {
      const p = catalogo.find(x => x.id === it.produtoId);
      const qtd = Math.max(0, Math.min(50, parseInt(it.qtd, 10) || 0));
      if (!p || qtd <= 0) return send(res, 400, { erro: 'Item de pedido inválido.' });
      itens.push({ produtoId: p.id, produto: p.name, qtd, preco: p.price, total: p.price * qtd });
      subtotal += p.price * qtd;
    }

    // checagem de plausibilidade (não é a garantia final — essa só acontece
    // na confirmação do pagamento, dentro da transação atômica).
    const dia = todayKeyBR();
    const [estoque, vendido] = await Promise.all([
      kvGet('estoque_dia:' + dia), kvGet('vendido_dia:' + dia),
    ]);
    for (const it of itens) {
      const total0 = (estoque && estoque[it.produtoId] != null) ? estoque[it.produtoId] : DEFAULT_STOCK_QTY;
      const jaVendido = (vendido && vendido[it.produtoId]) || 0;
      if (it.qtd > total0 - jaVendido) {
        return send(res, 409, { erro: 'Estoque insuficiente pra ' + it.produto + ' agora. Tente uma quantidade menor.' });
      }
    }

    const taxaConfig = await carregarTaxaServico();
    const taxa = calcularTaxa(subtotal, taxaConfig);
    const total = Math.round((subtotal + taxa) * 100) / 100;

    const membros = await carregarMembros();
    const membro = encontrarMembro(membros, beneficiario);
    const compraId = gerarCompraId();

    const mpRes = await criarPagamentoPix({
      total, email, nomePagador: (membro ? membro.responsavel : responsavelFallback) || 'Responsável',
      descricao: 'Lanches — Cantina GEAB (' + beneficiario + ')',
      externalReference: compraId,
    });

    const paymentId = String(mpRes.id);
    const pix = (mpRes.point_of_interaction && mpRes.point_of_interaction.transaction_data) || {};

    await kvSet('pagamento:' + paymentId, {
      paymentId, compraId, itens, subtotal, taxa, total,
      beneficiario: beneficiario.toUpperCase(),
      ramo: membro ? membro.ramo : '',
      responsavel: membro ? membro.responsavel : responsavelFallback,
      celular: membro ? membro.celular : celularFallback,
      cadastrado: membro ? 'Sim' : 'Não',
      email, status: 'pendente', criadoEm: Date.now(), processadoEm: null,
    });

    send(res, 200, {
      paymentId, total,
      qrCode: pix.qr_code || null,
      qrCodeBase64: pix.qr_code_base64 || null,
      ticketUrl: pix.ticket_url || null,
    });
  } catch (e) {
    logger.error('criarPagamentoLoja', e);
    send(res, 500, { erro: 'Não foi possível gerar o pagamento. Tente de novo em instantes.' });
  }
});

// ---------- 4. webhook do Mercado Pago ----------

exports.webhookMercadoPago = onRequest({ cors: false, secrets: MP_SECRETS }, async (req, res) => {
  try {
    const paymentId = String(
      (req.body && req.body.data && req.body.data.id) || req.query['data.id'] || req.query.id || ''
    );
    if (!paymentId) return res.status(200).send('ignorado: sem id de pagamento');

    // nunca confia no corpo do aviso — confere direto na API do Mercado Pago.
    const pagamentoMP = await buscarPagamento(paymentId);
    if (pagamentoMP.status !== 'approved') {
      return res.status(200).send('ignorado: status ' + pagamentoMP.status);
    }

    const pedido = await kvGet('pagamento:' + paymentId);
    if (!pedido) return res.status(200).send('ignorado: pedido não encontrado');
    if (pedido.status === 'processado') return res.status(200).send('ok: já processado');

    const dia = todayKeyBR();
    const vendidoKey = 'vendido_dia:' + dia;
    const estoqueKey = 'estoque_dia:' + dia;
    const custoKey = 'custo_estoque';

    await db.runTransaction(async (tx) => {
      const [vendidoSnap, estoqueSnap, custoSnap] = await Promise.all([
        tx.get(db.collection('cantina_kv').doc(vendidoKey)),
        tx.get(db.collection('cantina_kv').doc(estoqueKey)),
        tx.get(db.collection('cantina_kv').doc(custoKey)),
      ]);
      const vendidoAtual = vendidoSnap.exists ? vendidoSnap.data().v : {};
      const estoqueAtual = estoqueSnap.exists ? estoqueSnap.data().v : {};
      const custoAtual = custoSnap.exists ? custoSnap.data().v : {};

      for (const it of pedido.itens) {
        const ts = Date.now();
        const key = 'venda:' + ts + '_' + Math.random().toString(36).slice(2, 7);
        const c = custoAtual[it.produtoId];
        const custoUnitNaVenda = (c && c.qtd > 0) ? c.total / c.qtd : null;
        // o pagamento já aconteceu — sempre registra a venda, mesmo se o estoque
        // esgotou entre o pedido e a confirmação. Só sinaliza pro chefe conferir.
        const total0 = estoqueAtual[it.produtoId] != null ? estoqueAtual[it.produtoId] : DEFAULT_STOCK_QTY;
        const possivelEstoqueInsuficiente = it.qtd > total0 - (vendidoAtual[it.produtoId] || 0);
        const sale = {
          id: key, ts, day: dia, produtoId: it.produtoId, produto: it.produto,
          qtd: it.qtd, preco: it.preco, total: it.total, custoUnitNaVenda,
          forma: 'Mercado Pago', status: 'Pago', origem: 'remoto',
          retirado: false, retiradoEm: null, retiradoDia: null,
          cancelado: false, canceladoEm: null, canceladoMotivo: '',
          beneficiario: pedido.beneficiario, ramo: pedido.ramo, chefe: 'Loja online',
          cadastrado: pedido.cadastrado, responsavel: pedido.responsavel, celular: pedido.celular,
          paidVia: null, paidAt: null, paidDay: null, cobrado: false, cobradoEm: null,
          compraId: pedido.compraId, valorRecebido: null, troco: null,
          possivelEstoqueInsuficiente,
        };
        tx.set(db.collection('cantina_kv').doc(key), { v: sale });
        vendidoAtual[it.produtoId] = (vendidoAtual[it.produtoId] || 0) + it.qtd;
        if (custoUnitNaVenda != null) {
          custoAtual[it.produtoId] = {
            total: Math.max(0, c.total - custoUnitNaVenda * it.qtd),
            qtd: Math.max(0, c.qtd - it.qtd),
          };
        }
      }
      tx.set(db.collection('cantina_kv').doc(vendidoKey), { v: vendidoAtual });
      tx.set(db.collection('cantina_kv').doc(custoKey), { v: custoAtual });
      tx.update(db.collection('cantina_kv').doc('pagamento:' + paymentId), {
        'v.status': 'processado', 'v.processadoEm': Date.now(),
      });
    });

    res.status(200).send('ok: venda registrada');
  } catch (e) {
    logger.error('webhookMercadoPago', e);
    // 500 faz o Mercado Pago tentar de novo mais tarde — correto quando é falha nossa (ex.: instabilidade).
    res.status(500).send('erro ao processar');
  }
});

// ---------- 5. status do pagamento (pra loja mostrar "confirmado!" sem recarregar) ----------

exports.statusPagamento = onRequest({ cors: CORS_ORIGINS }, async (req, res) => {
  try {
    const paymentId = String(req.query.id || '');
    if (!paymentId) return send(res, 400, { erro: 'Informe o id do pagamento.' });
    const pedido = await kvGet('pagamento:' + paymentId);
    if (!pedido) return send(res, 404, { erro: 'Pedido não encontrado.' });
    send(res, 200, { status: pedido.status });
  } catch (e) {
    logger.error('statusPagamento', e);
    send(res, 500, { erro: 'Não foi possível consultar o status.' });
  }
});
