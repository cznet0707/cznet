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

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const ips = Object.values(os.networkInterfaces())
      .flat()
      .filter(i => i.family === 'IPv4' && !i.internal)
      .map(i => i.address);
    console.log('\n✅ Servidor CZnET rodando!');
    console.log(`\n💻  Neste computador: http://localhost:${PORT}`);
    ips.forEach(ip => console.log(`🖥️  Outro PC na rede:  http://${ip}:${PORT}`));
    console.log('\nPressione Ctrl+C para parar.\n');
  });
}

module.exports = app;
