const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app      = express();
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'dados.json');
const PORT     = process.env.PORT || 3000;

app.use(express.json({ limit: '100mb' }));
app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'clientes-mensalidades.html'));
});
// carregar dados
app.get('/api/data', (req, res) => {
  try {
    if (fs.existsSync(DATA_FILE)) {
      res.json(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
    } else {
      res.json({});
    }
  } catch(e) {
    res.json({});
  }
});

// Salvar dados
app.post('/api/data', (req, res) => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ erro: e.message });
  }
});

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