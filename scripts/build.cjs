const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const assets = {};
for (const name of fs.readdirSync(path.join(root, 'dist'))) {
  if (/\.(html|css|js)$/.test(name)) assets['/' + name] = read('dist/' + name);
}
const core = read('dist/seller-core.js');
const api = read('server/api.mjs').replace(/^import .*;$/gm, '').replace('export async function handleApi', 'async function handleApi');
const courier = read('server/courier.mjs').replace('export function createCourierRoutes', 'function createCourierRoutes');
const worker = `${core}\n${courier}\n${api}\nconst assets=${JSON.stringify(assets)};\nexport default {async fetch(request,env){const url=new URL(request.url);if(url.pathname.startsWith('/api/'))return handleApi(request,env,request.headers.get('CF-Connecting-IP')||'unknown');if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});const name=['/','/admin'].includes(url.pathname)?'/admin.html':url.pathname==='/courier'?'/courier.html':url.pathname;const value=assets[name];if(value===undefined)return new Response('Not found',{status:404});const type=name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html';return new Response(request.method==='HEAD'?null:value,{headers:{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY'}})}};\n`;
fs.mkdirSync(path.join(root, 'dist/server'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/server/index.js'), worker);
fs.mkdirSync(path.join(root, 'dist/.openai'), { recursive: true });
fs.copyFileSync(path.join(root, '.openai/hosting.json'), path.join(root, 'dist/.openai/hosting.json'));
console.log('Worker built with ' + Object.keys(assets).length + ' assets.');
