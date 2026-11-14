const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createApp } = require('./serve.cjs');
const { openDatabase } = require('./server/database.cjs');

async function harness(t, databasePath = ':memory:') {
  const server = await createApp({ databasePath });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const close = () => new Promise(resolve => server.close(resolve));
  t.after(() => server.listening && close());
  async function request(route, { data, cookie, method, headers } = {}) {
    const res = await fetch(base + '/api' + route, {
      method: method || (data === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', 'X-Birga-Request': '1', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) })
    });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0], headers: res.headers };
  }
  async function register(email = 'owner@example.com') {
    const result = await request('/auth/register', { data: { name: 'Biznes Egasi', email, password: 'TestPassword-2026!' } });
    assert.equal(result.status, 201, JSON.stringify(result.data)); return result.cookie;
  }
  async function business(cookie, name = 'Restoran', kind = 'restaurant') {
    const result = await request('/businesses', { cookie, data: { name, kind } });
    assert.equal(result.status, 201); return result.data.business.id;
  }
  const state = async (cookie, id) => (await request('/businesses/' + id + '/state', { cookie })).data;
  const save = (cookie, id, data) => request('/businesses/' + id + '/state', { cookie, data: { revision: data.business?.revision ?? data.revision, state: data.state }, method: 'PUT' });
  return { server, base, close, request, register, business, state, save };
}

test('authentication, CSRF protection, password validation and session revocation', async t => {
  const h = await harness(t);
  assert.equal((await h.request('/businesses')).status, 401);
  assert.equal((await h.request('/auth/register', { data: {}, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await h.request('/auth/register', { data: {}, headers: { 'X-Birga-Request': '0' } })).status, 403);
  assert.equal((await h.request('/auth/register', { data: { name: 'Owner', email: 'bad', password: 'long-password' } })).status, 400);
  assert.equal((await h.request('/auth/register', { data: { name: 'Owner', email: 'ok@example.com', password: 'short' } })).status, 400);
  const cookie = await h.register();
  assert.equal((await h.request('/auth/register', { data: { name: 'Other', email: 'OWNER@example.com', password: 'TestPassword-2026!' } })).status, 409);
  const me = await h.request('/auth/me', { cookie });
  assert.equal(me.data.user.email, 'owner@example.com');
  assert.equal(me.data.user.password_hash, undefined);
  assert.equal((await h.request('/auth/login', { data: { email: 'owner@example.com', password: 'wrong-password' } })).status, 401);
  assert.equal((await h.request('/auth/logout', { cookie, data: {} })).status, 200);
  assert.equal((await h.request('/auth/me', { cookie })).status, 401);
  const login = await h.request('/auth/login', { data: { email: 'owner@example.com', password: 'TestPassword-2026!' } });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal((await h.request('/auth/me', { cookie: login.cookie })).status, 200);
});

test('multiple businesses remain separate and inaccessible to another owner', async t => {
  const h = await harness(t), alice = await h.register('alice@example.com'), bob = await h.register('bob@example.com');
  const restaurant = await h.business(alice, 'Rayhon', 'restaurant');
  const shop = await h.business(alice, 'Birga Shop', 'shop');
  const service = await h.business(bob, 'Studio', 'service');
  const list = await h.request('/businesses', { cookie: alice });
  assert.equal(list.data.businesses.length, 2); assert.ok(list.data.businesses.every(b => b.sales === 0 && b.pending === 0));
  assert.equal((await h.request('/businesses/' + restaurant + '/state', { cookie: bob })).status, 404);
  const restaurantState = await h.state(alice, restaurant);
  assert.equal((await h.save(bob, restaurant, restaurantState)).status, 404);
  restaurantState.state.menu.push({ id: 1, name: 'Osh', cat: 'Milliy taomlar', price: 38000, img: '', modifiers: '', stop: false });
  assert.equal((await h.save(alice, restaurant, restaurantState)).status, 200);
  assert.equal((await h.state(alice, shop)).state.menu.length, 0);
  assert.deepEqual((await h.state(bob, service)).state.categories, ['Xizmatlar']);
});

test('server validation and revision checks prevent invalid or stale writes', async t => {
  const h = await harness(t), cookie = await h.register(), id = await h.business(cookie);
  const initial = await h.state(cookie, id), next = structuredClone(initial);
  next.state.settings.name = 'New Name';
  const saved = await h.save(cookie, id, next); assert.equal(saved.status, 200); assert.equal(saved.data.business.revision, 2);
  assert.equal((await h.save(cookie, id, initial)).status, 409);
  const invalid = structuredClone(saved.data); invalid.state.menu.push({ id: 1, name: 'Osh', cat: 'Milliy taomlar', price: -2, img: '', modifiers: '', stop: false });
  assert.equal((await h.save(cookie, id, invalid)).status, 400);
  const malformed = structuredClone(saved.data); malformed.state.branches = [null];
  assert.equal((await h.save(cookie, id, malformed)).status, 400);
  const commission = structuredClone(saved.data); commission.state.settings.commission = 99;
  assert.equal((await h.save(cookie, id, commission)).status, 400);
  assert.equal((await h.state(cookie, id)).business.revision, 2);
});

test('order lifecycle is enforced by server and portfolio totals use completed orders', async t => {
  const h = await harness(t), cookie = await h.register(), id = await h.business(cookie);
  let current = await h.state(cookie, id);
  // Keep the test independent of the time of day in Tashkent.
  const now = new Date();
  const minute = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':')[1]);
  current.state.hours.forEach(h => { h.open = minute === 59 ? '00:01' : '00:00'; h.close = minute === 59 ? '00:00' : '23:59'; h.off = false; });
  current.state.menu.push({ id: 1, name: 'Osh', cat: 'Milliy taomlar', price: 38000, img: '', modifiers: '', stop: false });
  current.state.orders.push({ id: 1, customer: 'Aziza', branch: 1, status: 'new', type: 'Olib ketish', payment: 'Naqd', created: Date.now(), items: [{ name: 'Osh', qty: 2, price: 38000 }] });
  let result = await h.save(cookie, id, current); assert.equal(result.status, 200, JSON.stringify(result.data)); current = result.data;
  const skip = structuredClone(current); skip.state.orders[0].status = 'done';
  assert.equal((await h.save(cookie, id, skip)).status, 400);
  const forged = structuredClone(current); forged.state.orders[0].items[0].price = 1;
  assert.equal((await h.save(cookie, id, forged)).status, 400);
  for (const status of ['preparing', 'ready', 'done']) {
    current.state.orders[0].status = status;
    if (status === 'preparing') { current.state.orders[0].minutes = 20; current.state.orders[0].accepted = 1; }
    if (status === 'done') current.state.orders[0].completed = 1;
    result = await h.save(cookie, id, current); assert.equal(result.status, 200, JSON.stringify(result.data)); current = result.data;
  }
  assert.ok(current.state.orders[0].completed > Date.now() - 10000);
  const list = (await h.request('/businesses', { cookie })).data.businesses;
  assert.equal(list[0].sales, 76000); assert.equal(list[0].completed, 1); assert.equal(list[0].pending, 0);
  const deleted = structuredClone(current); deleted.state.orders = [];
  assert.equal((await h.save(cookie, id, deleted)).status, 400);
});

test('database and login session survive a full server restart', async t => {
  await fs.mkdir(path.join(__dirname, '.qa'), { recursive: true });
  const dir = await fs.mkdtemp(path.join(__dirname, '.qa', 'database-'));
  const filename = path.join(dir, 'birga.sqlite');
  let h = await harness(t, filename), cookie = await h.register(), id = await h.business(cookie, 'Persistent Shop', 'shop');
  const data = await h.state(cookie, id); data.state.busy = true;
  assert.equal((await h.save(cookie, id, data)).status, 200);
  await h.close(); h = await harness(t, filename);
  assert.equal((await h.request('/auth/me', { cookie })).status, 200);
  assert.equal((await h.state(cookie, id)).state.busy, true);
  assert.equal((await h.request('/businesses', { cookie })).data.businesses[0].name, 'Persistent Shop');
});

test('built Worker serves assets and uses the same database/authentication API', async t => {
  const DB = openDatabase(':memory:'); t.after(() => DB.close());
  const source = await fs.readFile(path.join(__dirname, 'dist/server/index.js'), 'utf8');
  const worker = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
  const page = await worker.fetch(new Request('https://birga.example/'), { DB });
  assert.equal(page.status, 200); assert.match(await page.text(), /BIRGA Owner/);
  assert.equal((await worker.fetch(new Request('https://birga.example/owner.css'), { DB })).status, 200);
  const response = await worker.fetch(new Request('https://birga.example/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Birga-Request': '1' }, body: JSON.stringify({ name: 'Worker Owner', email: 'worker@example.com', password: 'WorkerPassword-2026' }) }), { DB });
  assert.equal(response.status, 201, await response.clone().text());
  assert.match(response.headers.get('set-cookie'), /; Secure/);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await worker.fetch(new Request('https://birga.example/api/businesses', { headers: { Cookie: cookie } }), { DB })).status, 200);
  const courierPage = await worker.fetch(new Request('https://birga.example/courier'), { DB });
  assert.equal(courierPage.status, 200); assert.match(await courierPage.text(), /BIRGA Kuryer/);
  const courierResponse = await worker.fetch(new Request('https://birga.example/api/courier/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Birga-Request': '1' }, body: JSON.stringify({ name: 'Worker Courier', email: 'courier-worker@example.com', password: 'CourierPassword-2026', phone: '+998901234567', vehicle: 'car', city: 'Toshkent' }) }), { DB });
  assert.equal(courierResponse.status, 201, await courierResponse.clone().text());
  const courierCookie = courierResponse.headers.get('set-cookie').split(';')[0];
  const dashboard = await worker.fetch(new Request('https://birga.example/api/courier/dashboard', { headers: { Cookie: courierCookie } }), { DB });
  assert.equal(dashboard.status, 200); assert.equal((await dashboard.json()).profile.vehicle, 'car');
});
