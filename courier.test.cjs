const test = require('node:test'), assert = require('node:assert/strict');
const { openDatabase } = require('./server/database.cjs');
async function setup(t) {
  const DB = openDatabase(':memory:'); t.after(() => DB.close());
  const { handleApi } = await import('./server/api.mjs');
  async function request(route, data, cookie, method) {
    const response = await handleApi(new Request('https://birga.example/api' + route, { method: method || (data === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', 'X-Birga-Request': '1', ...(cookie ? { Cookie: cookie } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }), { DB }, 'test');
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function account(email, courier = false) {
    const r = await request((courier ? '/courier' : '') + '/auth/register', { name: courier ? 'Kuryer' : 'Egasi', email, password: 'TestPassword-2026', phone: '+998901234567', vehicle: 'bicycle', city: 'Toshkent' });
    assert.equal(r.status, 201, JSON.stringify(r.data)); return r.cookie;
  }
  const owner = await account('owner@example.com');
  const b = await request('/businesses', { name: 'Rayhon', kind: 'restaurant' }, owner), id = b.data.business.id;
  const path = '/businesses/' + id;
  let state = (await request(path + '/state', undefined, owner)).data;
  state.state.branches[0].address = 'Amir Temur 24, Toshkent'; state.state.settings.phone = '+998901111111';
  const minute = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':')[1]);
  state.state.hours.forEach(h => { h.open = minute === 59 ? '00:01' : '00:00'; h.close = minute === 59 ? '00:00' : '23:59'; h.off = false; });
  state.state.menu.push({ id: 1, name: 'Osh', cat: 'Milliy taomlar', price: 38000, img: '', modifiers: '', stop: false });
  state.state.orders = [1, 2].map(orderId => ({ id: orderId, customer: 'Aziza', phone: '+998902222222', address: 'Yunusobod 4, 18-uy', branch: 1, status: 'new', type: 'Yetkazib berish', payment: 'Naqd', created: Date.now(), items: [{ name: 'Osh', qty: 2, price: 38000 }] }));
  async function save(current) { return request(path + '/state', { state: current.state, revision: current.business.revision }, owner, 'PUT'); }
  let r = await save(state); assert.equal(r.status, 200); state = r.data;
  for (const status of ['preparing', 'ready']) {
    state.state.orders.forEach(o => { o.status = status; if (status === 'preparing') { o.minutes = 20; o.accepted = 1; } });
    r = await save(state); assert.equal(r.status, 200, JSON.stringify(r.data)); state = r.data;
  }
  const invitation = await request(path + '/courier-invite', {}, owner);
  assert.equal(invitation.status, 200);
  async function join(cookie, code = invitation.data.code) { return request('/courier/join', { code }, cookie); }
  async function online(cookie, value = true) { return request('/courier/profile', { name: 'Kuryer', phone: '+998901234567', vehicle: 'bicycle', city: 'Toshkent', online: value }, cookie, 'PUT'); }
  async function dispatch(orderId = 1) {
    const response = await request(path + '/deliveries', { orderId, fee: 15000 }, owner);
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.deliveries.find(d => d.orderId === orderId).id;
  }
  return { DB, request, account, owner, id, path, join, online, dispatch, save, invitation };
}

test('courier and owner identities, sessions and permissions are separate', async t => {
  const h = await setup(t), courier = await h.account('owner@example.com', true);
  assert.match(courier, /^birga_courier_session=/);
  assert.equal((await h.request('/businesses', undefined, courier)).status, 401);
  assert.equal((await h.request('/courier/dashboard', undefined, h.owner)).status, 401);
  assert.equal((await h.request('/courier/auth/login', { email: 'owner@example.com', password: 'wrong' })).status, 401);
  const both = h.owner + '; ' + courier;
  assert.equal((await h.request('/auth/me', undefined, both)).status, 200);
  assert.equal((await h.request('/courier/auth/me', undefined, both)).status, 200);
  assert.equal((await h.request('/courier/auth/logout', {}, both)).status, 200);
  assert.equal((await h.request('/courier/auth/me', undefined, both)).status, 401);
  assert.equal((await h.request('/auth/me', undefined, both)).status, 200);
});

test('only invited couriers see jobs; available listings omit customer information', async t => {
  const h = await setup(t), courier = await h.account('courier@example.com', true), outsider = await h.account('outsider@example.com');
  await h.online(courier); const delivery = await h.dispatch();
  assert.equal((await h.request('/courier/dashboard', undefined, courier)).data.available.length, 0);
  assert.equal((await h.request('/courier/jobs/' + delivery + '/accept', {}, courier)).status, 409);
  assert.equal((await h.request(h.path + '/courier-invite', {}, outsider)).status, 404);
  assert.equal((await h.join(courier, 'bad-code')).status, 400);
  assert.equal((await h.join(courier)).status, 200);
  const dashboard = (await h.request('/courier/dashboard', undefined, courier)).data;
  assert.equal(dashboard.partners.length, 1); assert.equal(dashboard.available.length, 1);
  assert.equal(dashboard.available[0].customer, undefined); assert.equal(dashboard.available[0].items, undefined);
  assert.equal(dashboard.available[0].pickup.address, 'Amir Temur 24, Toshkent');
  const renewed = await h.request(h.path + '/courier-invite', {}, h.owner);
  const other = await h.account('other@example.com', true);
  assert.equal((await h.join(other)).status, 400);
  assert.equal((await h.join(other, renewed.data.code)).status, 200);
});

test('competing claims assign exactly one courier; delivery completion synchronizes owner sales', async t => {
  const h = await setup(t), a = await h.account('a@example.com', true), b = await h.account('b@example.com', true);
  await h.join(a); await h.join(b); await h.online(a); await h.online(b);
  const delivery = await h.dispatch(), action = '/courier/jobs/' + delivery;
  const attempts = await Promise.all([h.request(action + '/accept', {}, a), h.request(action + '/accept', {}, b)]);
  assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409]);
  const winner = attempts[0].status === 200 ? a : b, loser = winner === a ? b : a;
  const active = (await h.request('/courier/dashboard', undefined, winner)).data.active[0];
  assert.equal(active.customer.phone, '+998902222222'); assert.equal(active.total, 76000);
  assert.equal((await h.request('/courier/dashboard', undefined, loser)).data.active.length, 0);
  assert.equal((await h.request(action + '/pickup', {}, loser)).status, 409);
  assert.equal((await h.request(action + '/deliver', {}, winner)).status, 409);
  assert.equal((await h.online(winner, false)).status, 409);
  const before = (await h.request(h.path + '/state', undefined, h.owner)).data;
  const manual = structuredClone(before); manual.state.orders[0].status = 'done'; manual.state.orders[0].completed = 1;
  assert.equal((await h.save(manual)).status, 409);
  assert.equal((await h.request(action + '/pickup', {}, winner)).status, 200);
  const delivered = await h.request(action + '/deliver', {}, winner);
  assert.equal(delivered.status, 200, JSON.stringify(delivered.data));
  assert.equal(delivered.data.stats.earned, 15000); assert.equal(delivered.data.stats.delivered, 1);
  assert.equal(delivered.data.history[0].customer, undefined);
  assert.equal((await h.request(action + '/deliver', {}, winner)).status, 409);
  const after = (await h.request(h.path + '/state', undefined, h.owner)).data;
  assert.equal(after.state.orders[0].status, 'done'); assert.ok(after.state.orders[0].completed);
  assert.equal(after.business.revision, before.business.revision + 1);
  assert.equal(after.deliveries[0].status, 'delivered');
  assert.equal((await h.save(before)).status, 409);
  assert.equal((await h.request('/businesses', undefined, h.owner)).data.businesses[0].sales, 76000);
});

test('one active delivery per courier, controlled release, cancellation and membership removal', async t => {
  const h = await setup(t), courier = await h.account('a@example.com', true);
  await h.join(courier); await h.online(courier);
  const one = await h.dispatch(1), two = await h.dispatch(2);
  const claims = await Promise.all([one, two].map(id => h.request('/courier/jobs/' + id + '/accept', {}, courier)));
  assert.deepEqual(claims.map(r => r.status).sort(), [200, 409]);
  const active = claims[0].status === 200 ? one : two, other = active === one ? two : one;
  const courierId = (await h.request('/courier/dashboard', undefined, courier)).data.profile.id;
  assert.equal((await h.request(h.path + '/couriers/' + courierId + '/remove', {}, h.owner)).status, 409);
  assert.equal((await h.request(h.path + '/deliveries/' + active + '/cancel', {}, h.owner)).status, 409);
  assert.equal((await h.request('/courier/jobs/' + active + '/release', { reason: ' ' }, courier)).status, 400);
  assert.equal((await h.request('/courier/jobs/' + active + '/release', { reason: 'Transport nosoz' }, courier)).status, 200);
  assert.equal((await h.request(h.path + '/deliveries/' + active + '/cancel', {}, h.owner)).status, 200);
  assert.equal((await h.request('/courier/jobs/' + other + '/accept', {}, courier)).status, 200);
  assert.equal((await h.request('/courier/jobs/' + other + '/pickup', {}, courier)).status, 200);
  assert.equal((await h.request('/courier/jobs/' + other + '/release', { reason: 'Qaytarish' }, courier)).status, 409);
  assert.equal((await h.request('/courier/jobs/' + other + '/deliver', {}, courier)).status, 200);
  assert.equal((await h.request(h.path + '/couriers/' + courierId + '/remove', {}, h.owner)).status, 200);
  assert.equal((await h.request('/courier/dashboard', undefined, courier)).data.partners.length, 0);
  assert.equal((await h.join(courier)).status, 400, 'Removal revokes old invite codes too');
});
