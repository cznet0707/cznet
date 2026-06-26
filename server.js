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

// Carregar dados
app.get('/api/data', async (req, res) => {
  try {
    if (MONGODB_URI) {
      const db = await getDb();
      const doc = await db.collection('dados').findOne({ _id: 'main' });
      res.json(doc ? doc.data : {});
    } else {
      if (fs.existsSync(DATA_FILE)) {
        res.json(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
      } else {
        res.json({});
      }
    }
  } catch(e) {
    res.json({});
  }
});

// Salvar dados
app.post('/api/data', async (req, res) => {
  try {
    if (MONGODB_URI) {
      const db = await getDb();
      await db.collection('dados').replaceOne(
        { _id: 'main' },
        { _id: 'main', data: req.body },
        { upsert: true }
      );
    } else {
      fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2));
    }
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ erro: e.message });
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