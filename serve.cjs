const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openDatabase } = require('./server/database.cjs');

async function createApp({ databasePath = process.env.BIRGA_DB_PATH || path.join(__dirname, 'data/birga.sqlite') } = {}) {
  const DB = openDatabase(databasePath);
  const { handleApi } = await import(pathToFileURL(path.join(__dirname, 'server/api.mjs')));
  const root = path.join(__dirname, 'dist');
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      if (url.pathname.startsWith('/api/')) {
        const init = { method: req.method, headers: req.headers };
        if (!['GET', 'HEAD'].includes(req.method)) { init.body = req; init.duplex = 'half'; }
        const response = await handleApi(new Request(url, init), { DB }, req.socket.remoteAddress);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        return res.end(Buffer.from(await response.arrayBuffer()));
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/market.html';
      if (pathname === '/admin') pathname = '/admin.html';
      if (pathname === '/courier') pathname = '/courier.html';
      const file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep) || !types[path.extname(file)] || pathname.startsWith('/server/')) { res.writeHead(404); return res.end('Not found'); }
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  server.on('close', () => DB.close());
  return server;
}
module.exports = { createApp };
if (require.main === module) createApp().then(server => {
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(Number(process.env.PORT || 4173), process.env.HOST || '127.0.0.1', () => console.log('BIRGA Owner: http://127.0.0.1:' + server.address().port));
}).catch(error => { console.error(error); process.exitCode = 1; });
