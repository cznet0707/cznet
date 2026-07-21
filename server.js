const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app          = express();
const PORT         = process.env.PORT || 3000;
const MONGODB_URI  = process.env.MONGODB_URI;
const DATA_FILE    = path.join(__dirname, 'dados.json');

app.use(express.json({ limit: '100mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'clientes-mensalidades.html'));
});

// MongoDB helper
let cachedDb = null;
async function getDb() {
  if (!cachedDb) {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    cachedDb = client.db('cznet');
  }
  return cachedDb;
}

// Lê o estado atual salvo (Mongo ou arquivo), incluindo o carimbo _updatedAt.
// Retorna sempre um objeto (nunca null) para simplificar as comparações.
async function lerDadosAtuais() {
  if (MONGODB_URI) {
    const db = await getDb();
    const doc = await db.collection('dados').findOne({ _id: 'main' });
    return (doc && doc.data) ? doc.data : {};
  }
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }
  return {};
}

async function gravarDadosAtuais(data) {
  if (MONGODB_URI) {
    const db = await getDb();
    await db.collection('dados').replaceOne(
      { _id: 'main' },
      { _id: 'main', data },
      { upsert: true }
    );
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
}

// Carregar dados
app.get('/api/data', async (req, res) => {
  try {
    const data = await lerDadosAtuais();
    res.json(data);
  } catch(e) {
    res.json({});
  }
});

// Salvar dados
//
// Proteção contra "sobrescrita silenciosa" (last-write-wins): cada save inclui
// _baseUpdatedAt = o _updatedAt que o dispositivo tinha na última leitura. Se
// alguém já salvou depois disso, recusamos com 409 e devolvemos os dados mais
// recentes, em vez de deixar o dispositivo atrasado apagar as mudanças do outro.
app.post('/api/data', async (req, res) => {
  try {
    const atual = await lerDadosAtuais();
    const atualUpdatedAt = atual._updatedAt || 0;
    const baseUpdatedAt   = req.body._baseUpdatedAt || 0;

    if (atualUpdatedAt && baseUpdatedAt && atualUpdatedAt !== baseUpdatedAt) {
      // Alguém salvou depois que este dispositivo carregou os dados: conflito.
      return res.status(409).json({
        ok: false,
        conflict: true,
        data: atual,
        updatedAt: atualUpdatedAt
      });
    }

    const novoUpdatedAt = Date.now();
    const novoDado = { ...req.body, _updatedAt: novoUpdatedAt };
    delete novoDado._baseUpdatedAt;

    await gravarDadosAtuais(novoDado);
    res.json({ ok: true, updatedAt: novoUpdatedAt });
  } catch(e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ================== ALERTA DE CLIENTE EM ATRASO (WhatsApp via CallMeBot) ==================
//
// Configuração necessária (Vercel > Project > Settings > Environment Variables):
//   CALLMEBOT_PHONE   -> seu número com DDI, ex: 5582999999999
//   CALLMEBOT_APIKEY  -> apikey que o bot te mandou no WhatsApp
//   CRON_SECRET       -> uma senha aleatória qualquer (protege os endpoints abaixo)
//
// Depois de configurar e fazer o deploy, rode UMA VEZ manualmente:
//   https://SEU-APP.vercel.app/api/seed-notificados?key=SEU_CRON_SECRET
// (isso marca os atrasados de hoje como "linha de base" pra não vir um WhatsApp
//  gigante com todo o histórico atual assim que o recurso for ligado)
//
// A partir daí, o Vercel Cron chama /api/check-atrasos 1x por dia sozinho.

async function enviarWhatsAppDono(texto) {
  const phone  = process.env.CALLMEBOT_PHONE;
  const apikey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apikey) {
    console.log('[callmebot] CALLMEBOT_PHONE/CALLMEBOT_APIKEY não configurados, pulando envio.');
    return { ok: false, motivo: 'sem_config' };
  }
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(apikey)}`;
  try {
    const r = await fetch(url);
    const body = await r.text();
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

function mesAtualStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Clientes cujo dia de vencimento já passou neste mês e que ainda não têm
// pagamento lançado para o mês atual.
function calcularClientesEmAtraso(data) {
  const clientes   = JSON.parse(data.cm_clientes   || '[]');
  const pagamentos = JSON.parse(data.cm_pagamentos || '[]');
  const hoje    = new Date();
  const diaHoje = hoje.getDate();
  const mes     = mesAtualStr(hoje);

  return clientes.filter(c => {
    if (!c.dia) return false;
    const pago = pagamentos.some(p => p.clienteId === c.id && p.mes === mes);
    if (pago) return false;
    return diaHoje > c.dia;
  });
}

// Aceita tanto o header que o Vercel Cron manda sozinho (Authorization: Bearer)
// quanto ?key=... na URL, pra dar pra rodar manualmente pelo navegador também.
function checarAutorizacaoCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // sem CRON_SECRET configurado, não bloqueia (defina em produção!)
  const auth = req.headers['authorization'] || '';
  if (auth === `Bearer ${secret}`) return true;
  if (req.query.key === secret) return true;
  return false;
}

// Roda 1x por dia (via Vercel Cron): descobre quem ficou em atraso e ainda
// não foi avisado neste mês, manda 1 WhatsApp único pro dono e marca como avisado.
app.get('/api/check-atrasos', async (req, res) => {
  if (!checarAutorizacaoCron(req)) return res.status(401).json({ ok: false, erro: 'não autorizado' });
  try {
    const data = await lerDadosAtuais();
    const mes  = mesAtualStr();
    const notificados = data.cm_notificados_atraso ? JSON.parse(data.cm_notificados_atraso) : {};

    const emAtraso = calcularClientesEmAtraso(data);
    const novos = emAtraso.filter(c => !notificados[`${c.id}_${mes}`]);

    if (novos.length === 0) {
      return res.json({ ok: true, novos: 0 });
    }

    const linhas = novos.map(c => `• ${c.nome}${c.tel ? ' - ' + c.tel : ''} (venc. dia ${c.dia})`);
    const texto = `⚠️ Cliente(s) que ficaram em atraso hoje:\n\n${linhas.join('\n')}`;

    const envio = await enviarWhatsAppDono(texto);

    novos.forEach(c => { notificados[`${c.id}_${mes}`] = true; });
    data.cm_notificados_atraso = JSON.stringify(notificados);
    data._updatedAt = Date.now();
    await gravarDadosAtuais(data);

    res.json({ ok: true, novos: novos.length, envio });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// Rodar 1 ÚNICA VEZ, manualmente, logo após configurar o recurso: marca o
// atraso já existente como linha de base, sem disparar WhatsApp nenhum.
app.get('/api/seed-notificados', async (req, res) => {
  if (!checarAutorizacaoCron(req)) return res.status(401).json({ ok: false, erro: 'não autorizado' });
  try {
    const data = await lerDadosAtuais();
    const mes  = mesAtualStr();
    const notificados = data.cm_notificados_atraso ? JSON.parse(data.cm_notificados_atraso) : {};
    const emAtraso = calcularClientesEmAtraso(data);
    emAtraso.forEach(c => { notificados[`${c.id}_${mes}`] = true; });
    data.cm_notificados_atraso = JSON.stringify(notificados);
    data._updatedAt = Date.now();
    await gravarDadosAtuais(data);
    res.json({ ok: true, marcados: emAtraso.length });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const ips =Object.values(os.networkInterfaces()).flat()
      .filter(i => i.family === 'IPv4' && !i.internal)
      .map(i => i.address);
    console.log('\n✅ Servidor CZnET rodando!');
    console.log(`\n💻  Neste computador: http://localhost:${PORT}`);
    ips.forEach(ip => console.log(`🖥️  Outro PC na rede:  http://${ip}:${PORT}`));
    console.log('\nPressione Ctrl+C para parar.\n');
  });
}

module.exports = app;
