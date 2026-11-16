import '../dist/seller-core.js';
import { createCourierRoutes } from './courier.mjs';

const Core = globalThis.SellerCore;
const enc = new TextEncoder();
const SESSION_AGE = 7 * 86400000;
const kinds = ['restaurant', 'shop', 'service', 'other'];
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const textValue = (v, max, required = true) => {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) fail(400, 'Matn maydonlarini to‘g‘ri to‘ldiring.');
  return v.trim();
};
const bool = v => { if (typeof v !== 'boolean') fail(400, 'Holat noto‘g‘ri.'); return v; };
const number = (v, min, max, integer = false) => {
  if (!Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) fail(400, 'Raqam noto‘g‘ri.');
  return v;
};
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async value => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
}
function equalHash(a, b) { let diff = a.length ^ b.length; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0); return diff === 0; }
function cookie(request, token, maxAge = SESSION_AGE / 1000, courier = false) {
  return `${courier ? 'birga_courier_session' : 'birga_session'}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'JSON talab qilinadi.');
  if (Number(request.headers.get('content-length')) > 2 * 1024 * 1024) fail(413, 'Ma’lumot hajmi 2 MB dan oshmasin.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Ma’lumot yuborilmadi.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); fail(413, 'Ma’lumot hajmi 2 MB dan oshmasin.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { fail(400, 'JSON noto‘g‘ri.'); }
}
async function limit(db, key, maximum, duration) {
  const now = Date.now();
  await db.prepare('INSERT INTO auth_limits (key,attempts,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END, reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END').bind(key, now + duration, now, now).run();
  const row = await db.prepare('SELECT attempts FROM auth_limits WHERE key=?').bind(key).first();
  if (row.attempts > maximum) fail(429, 'Urinishlar ko‘paydi. Birozdan so‘ng qayta urinib ko‘ring.');
}
function sessionToken(request, courier = false) {
  return request.headers.get('cookie')?.match(new RegExp('(?:^|;\\s*)' + (courier ? 'birga_courier_session' : 'birga_session') + '=([a-f0-9]{64})(?:;|$)'))?.[1];
}
async function currentUser(request, db, courier = false) {
  const token = sessionToken(request, courier);
  if (!token) return null;
  return db.prepare(`SELECT u.id,u.name,u.email FROM ${courier ? 'courier_sessions' : 'sessions'} s JOIN ${courier ? 'courier_accounts' : 'users'} u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await digest(token), Date.now()).first();
}
function freshState(name, owner, kind) {
  const s = Core.seed();
  Object.assign(s.settings, { name, phone: '', address: '', commission: 0 });
  s.menu = []; s.orders = []; s.promos = []; s.reviews = [];
  if (kind !== 'restaurant') s.categories = kind === 'service' ? ['Xizmatlar'] : ['Umumiy'];
  s.branches = [{ id: 1, name: 'Asosiy filial', address: 'Manzilni sozlamalarda kiriting', active: true }];
  s.staff = [{ id: 1, name: owner.name, phone: '', role: 'Egasi' }];
  return s;
}
function operatingNow(s) {
  if (s.busy) return false;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type).value;
  const index = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(get('weekday'));
  const today = s.hours[index], previous = s.hours[(index + 6) % 7], time = get('hour') + ':' + get('minute');
  return (!today.off && (today.open < today.close ? time >= today.open && time < today.close : time >= today.open)) || (!previous.off && previous.open > previous.close && time < previous.close);
}
function validateState(s, previous) {
  if (!s || s.version !== 1 || typeof s !== 'object') fail(400, 'Kabinet ma’lumoti noto‘g‘ri.');
  for (const key of ['menu', 'orders', 'branches', 'hours', 'categories', 'promos', 'reviews', 'staff']) {
    if (!Array.isArray(s[key]) || s[key].length > (key === 'orders' ? 3000 : 1000)) fail(400, 'Ro‘yxat hajmi yoki shakli noto‘g‘ri.');
    if (key !== 'hours' && key !== 'categories') {
      const ids = s[key].map(row => number(row.id, 1, Number.MAX_SAFE_INTEGER, true));
      if (new Set(ids).size !== ids.length) fail(400, 'Takrorlangan yozuv identifikatori.');
    }
  }
  bool(s.busy);
  const settings = s.settings;
  if (!settings || !s.roles || typeof s.roles !== 'object' || Array.isArray(s.roles)) fail(400, 'Sozlamalar noto‘g‘ri.');
  textValue(settings.name, 100); textValue(settings.phone, 30, false); textValue(settings.address, 300, false);
  textValue(settings.logo, 1500, false); if (settings.logo && !/^https:\/\//i.test(settings.logo)) fail(400, 'Logotip HTTPS bo‘lishi kerak.');
  bool(settings.sound); bool(settings.notifications); number(settings.commission, 0, 100);
  if (settings.commission !== previous.settings.commission) fail(400, 'Komissiya server tomonidan belgilanadi.');
  s.categories = s.categories.map(category => textValue(category, 80));
  if (new Set(s.categories.map(c => c.toLowerCase())).size !== s.categories.length || !s.categories.length) fail(400, 'Kategoriyalar takrorlanmasin.');
  for (const p of s.menu) {
    try { Core.validateMenu(p, s.categories); } catch (e) { fail(400, e.message); }
    textValue(p.name, 160); textValue(p.img, 1500, false); textValue(p.modifiers, 2000, false); bool(p.stop);
  }
  if (!s.branches.length) fail(400, 'Kamida bitta filial bo‘lishi kerak.');
  for (const b of s.branches) { textValue(b.name, 100); textValue(b.address, 300); bool(b.active); }
  if (s.hours.length !== 7) fail(400, 'Haftalik jadval noto‘g‘ri.');
  for (const [i, h] of s.hours.entries()) {
    if (h.day !== previous.hours[i].day || !/^([01]\d|2[0-3]):[0-5]\d$/.test(h.open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(h.close)) fail(400, 'Ish vaqti noto‘g‘ri.');
    bool(h.off); if (!h.off && h.open === h.close) fail(400, 'Ochilish va yopilish vaqti farq qilsin.');
  }
  for (const [role, permissions] of Object.entries(s.roles)) {
    textValue(role, 40); if (!Array.isArray(permissions) || permissions.length > 20) fail(400, 'Rol ruxsatlari noto‘g‘ri.');
    permissions.forEach(p => textValue(p, 80));
  }
  if (!Array.isArray(s.roles.Egasi) || !s.roles.Egasi.includes('Barcha bo‘limlar')) fail(400, 'Egasi huquqlari saqlanishi kerak.');
  for (const member of s.staff) { textValue(member.name, 100); textValue(member.phone, 30, false); if (!Object.hasOwn(s.roles, member.role)) fail(400, 'Xodim roli noto‘g‘ri.'); }
  if (!s.staff.some(m => m.role === 'Egasi')) fail(400, 'Kamida bitta biznes egasi qolishi kerak.');
  for (const promo of s.promos) {
    textValue(promo.name, 100); textValue(promo.products, 2000, false); bool(promo.active); number(promo.discount, 1, 90, true);
    if (!['Chegirma', 'Promokod', 'Kombo'].includes(promo.type)) fail(400, 'Aksiya turi noto‘g‘ri.');
    if (promo.type === 'Kombo' && !promo.products.trim()) fail(400, 'Kombo tarkibini kiriting.');
  }
  const codes = s.promos.filter(p => p.type === 'Promokod').map(p => p.name.toLowerCase());
  if (new Set(codes).size !== codes.length) fail(400, 'Promokod takrorlanmasin.');
  for (const r of s.reviews) {
    textValue(r.name, 100); textValue(r.text, 2000); textValue(r.reply, 2000, false); number(r.rating, 1, 5, true); bool(r.complaint);
    if (r.complaint) textValue(r.complaintReason, 2000);
  }
  const oldOrders = new Map(previous.orders.map(o => [o.id, o]));
  for (const o of s.orders) {
    textValue(o.customer, 100); textValue(o.phone ?? '', 30, false); textValue(o.note ?? '', 2000, false); textValue(o.address ?? '', 300, false);
    if (!s.branches.some(b => b.id === o.branch)) fail(400, 'Buyurtma filiali topilmadi.');
    if (!['Yetkazib berish', 'Olib ketish', 'Joyida'].includes(o.type) || !['Naqd', 'Karta'].includes(o.payment)) fail(400, 'Buyurtma turi yoki to‘lov usuli noto‘g‘ri.');
    if (!['new', 'preparing', 'ready', 'done', 'rejected'].includes(o.status) || !Array.isArray(o.items) || !o.items.length || o.items.length > 100) fail(400, 'Buyurtma noto‘g‘ri.');
    number(o.created, 1, Date.now() + 60000, true);
    o.items.forEach(i => { textValue(i.name, 160); number(i.qty, 1, 1000, true); number(i.price, 1, 1e9); });
    const old = oldOrders.get(o.id);
    if (!old) {
      if (o.status !== 'new' || o.accepted || o.completed || o.reason) fail(400, 'Buyurtma yangi holatda yaratiladi.');
      if (o.items.some(i => !s.menu.some(p => p.name === i.name && p.price === i.price && !p.stop))) fail(400, 'Buyurtma mahsuloti yoki narxi noto‘g‘ri.');
      if (!s.branches.some(b => b.id === o.branch && b.active) || !operatingNow(s)) fail(400, 'Filial yopiq yoki biznes band.');
    } else {
      const immutable = ['customer', 'phone', 'note', 'address', 'branch', 'type', 'payment', 'created', 'items', 'requestId'];
      if (immutable.some(k => JSON.stringify(o[k]) !== JSON.stringify(old[k]))) fail(400, 'Mavjud buyurtma tarkibini o‘zgartirib bo‘lmaydi.');
      let expected = old;
      if (old.status !== o.status) {
        try { expected = Core.transition(old, o.status, { minutes: o.minutes, reason: o.reason }); } catch (e) { fail(400, e.message); }
        if (o.status === 'preparing') o.accepted = expected.accepted;
        if (o.status === 'done') o.completed = expected.completed;
        if (o.status === 'rejected') o.reason = expected.reason;
      }
      for (const k of ['accepted', 'completed', 'minutes', 'reason']) if (JSON.stringify(o[k]) !== JSON.stringify(expected[k])) fail(400, 'Buyurtma bosqichi ma’lumoti noto‘g‘ri.');
      oldOrders.delete(o.id);
    }
  }
  if (oldOrders.size) fail(400, 'Buyurtmalar tarixini o‘chirib bo‘lmaydi.');
  return s;
}
function businessInfo(row) { return { id: row.id, name: row.name, kind: row.kind, revision: row.revision, updatedAt: row.updated_at }; }
async function createBusiness(db, owner, input) {
  const name = textValue(input.name, 100);
  if (!kinds.includes(input.kind)) fail(400, 'Biznes turini tanlang.');
  const id = crypto.randomUUID(); const now = Date.now();
  await db.prepare('INSERT INTO businesses (id,owner_id,name,kind,state,revision,updated_at) VALUES (?,?,?,?,?,1,?)').bind(id, owner.id, name, input.kind, JSON.stringify(freshState(name, owner, input.kind)), now).run();
  return { id, name, kind: input.kind, revision: 1, updatedAt: now };
}

const Courier = createCourierRoutes({ fail, number, textValue, digest, random, json, body, limit, Core });

export async function handleApi(request, env, ip = 'unknown') {
  const db = env.DB;
  try {
    if (!db) fail(503, 'Ma’lumotlar bazasi ulanmagan.');
    const url = new URL(request.url), route = url.pathname, method = request.method;
    const courier = route.startsWith('/api/courier/');
    const auth = courier ? '/api/courier/auth' : '/api/auth';
    const accounts = courier ? 'courier_accounts' : 'users', sessions = courier ? 'courier_sessions' : 'sessions';
    if (!['GET', 'POST', 'PUT'].includes(method)) fail(405, 'So‘rov usuli qo‘llanmaydi.');
    if (method !== 'GET') {
      if (request.headers.get('x-birga-request') !== '1') fail(403, 'So‘rov himoyasi noto‘g‘ri.');
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) fail(403, 'Boshqa saytdan so‘rov qabul qilinmaydi.');
    }
    if (route === auth + '/register' && method === 'POST') {
      await limit(db, (courier ? 'courier-' : '') + 'register:' + await digest(ip), 10, 3600000);
      const input = await body(request);
      const name = textValue(input.name, 100), email = textValue(input.email, 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Email manzilini to‘g‘ri kiriting.');
      const password = textValue(input.password, 128); if (password.length < 10) fail(400, 'Parol kamida 10 belgidan iborat bo‘lsin.');
      const profile = courier ? Courier.profileValues(input) : null;
      const user = { id: crypto.randomUUID(), name, email }, salt = random();
      const passwordHash = await hashPassword(input.password, salt);
      try {
        if (courier) await db.prepare('INSERT INTO courier_accounts (id,email,name,password_hash,salt,created_at,phone,vehicle,city) VALUES (?,?,?,?,?,?,?,?,?)').bind(user.id, email, name, passwordHash, salt, Date.now(), profile.phone, profile.vehicle, profile.city).run();
        else await db.prepare('INSERT INTO users (id,email,name,password_hash,salt,created_at) VALUES (?,?,?,?,?,?)').bind(user.id, email, name, passwordHash, salt, Date.now()).run();
      }
      catch (e) { if (/unique/i.test(e.message)) fail(409, 'Bu email bilan hisob mavjud. Kirish bo‘limidan foydalaning.'); throw e; }
      const token = random(); await db.prepare(`INSERT INTO ${sessions} VALUES (?,?,?)`).bind(await digest(token), user.id, Date.now() + SESSION_AGE).run();
      return json({ user }, 201, { 'Set-Cookie': cookie(request, token, SESSION_AGE / 1000, courier) });
    }
    if (route === auth + '/login' && method === 'POST') {
      await limit(db, (courier ? 'courier-' : '') + 'login-ip:' + await digest(ip), 100, 900000);
      const input = await body(request), email = textValue(input.email, 254).toLowerCase();
      const loginKey = (courier ? 'courier-' : '') + 'login-email:' + await digest(email);
      await limit(db, loginKey, 12, 900000);
      textValue(input.password, 128);
      const row = await db.prepare(`SELECT * FROM ${accounts} WHERE email=?`).bind(email).first();
      const hash = await hashPassword(input.password, row?.salt ?? 'nonexistent-user-padding');
      if (!row || !equalHash(hash, row.password_hash)) fail(401, 'Email yoki parol noto‘g‘ri.');
      const token = random();
      await db.prepare(`DELETE FROM ${sessions} WHERE expires_at<=?`).bind(Date.now()).run();
      await db.prepare(`INSERT INTO ${sessions} VALUES (?,?,?)`).bind(await digest(token), row.id, Date.now() + SESSION_AGE).run();
      await db.prepare('DELETE FROM auth_limits WHERE key=?').bind(loginKey).run();
      return json({ user: { id: row.id, name: row.name, email: row.email } }, 200, { 'Set-Cookie': cookie(request, token, SESSION_AGE / 1000, courier) });
    }
    if (route === auth + '/logout' && method === 'POST') {
      const token = sessionToken(request, courier);
      if (token) await db.prepare(`DELETE FROM ${sessions} WHERE token_hash=?`).bind(await digest(token)).run();
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0, courier) });
    }
    if (route === '/api/food/restaurants' && method === 'GET') {
      const { results } = await db.prepare("SELECT id,name,state FROM businesses WHERE kind='restaurant' ORDER BY updated_at DESC").all();
      return json({ restaurants: results.map(row => {
        const s = JSON.parse(row.state);
        return { id: row.id, name: s.settings.name, address: s.settings.address, logo: s.settings.logo,
          open: operatingNow(s) && s.branches.some(b => b.active),
          branches: s.branches.filter(b => b.active).map(b => ({ id: b.id, name: b.name, address: b.address })),
          categories: s.categories, menu: s.menu.map(p => ({ id: p.id, name: p.name, cat: p.cat, price: p.price, img: p.img, stop: p.stop })) };
      }).filter(r => r.menu.length) });
    }
    const tracking = route.match(/^\/api\/food\/orders\/([a-f0-9-]{36})$/);
    if (tracking && method === 'GET') {
      const requestId = request.headers.get('X-Birga-Order') || '';
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(requestId)) fail(404, 'Buyurtma topilmadi.');
      const row = await db.prepare("SELECT state FROM businesses WHERE id=? AND kind='restaurant'").bind(tracking[1]).first();
      const s = row && JSON.parse(row.state), order = s?.orders.find(o => o.requestId === requestId);
      if (!order) fail(404, 'Buyurtma topilmadi.');
      const delivery = await db.prepare('SELECT status,fee FROM deliveries WHERE business_id=? AND order_id=?').bind(tracking[1], order.id).first();
      return json({ order: { id: order.id, restaurant: s.settings.name, status: order.status, total: Core.total(order), created: order.created, minutes: order.minutes, reason: order.reason, delivery: delivery && delivery.status !== 'cancelled' ? delivery : null } });
    }
    if (route === '/api/food/orders' && method === 'POST') {
      await limit(db, 'food:' + await digest(ip), 30, 3600000);
      const input = await body(request);
      const restaurantId = textValue(input.restaurantId, 36), requestId = textValue(input.requestId, 64);
      if (!/^[a-f0-9-]{36}$/.test(restaurantId) || !/^[a-f0-9-]{36}$/.test(requestId)) fail(400, 'Buyurtma identifikatori noto‘g‘ri.');
      const customer = textValue(input.customer, 100), phone = textValue(input.phone, 30), address = textValue(input.address, 300), note = textValue(input.note ?? '', 2000, false);
      if (!/^\+998\d{9}$/.test(phone.replace(/[\s()-]/g, ''))) fail(400, 'Telefonni +998 bilan to‘liq kiriting.');
      if (!Array.isArray(input.items) || !input.items.length || input.items.length > 50) fail(400, 'Savatni tekshiring.');
      if (input.items.some(i => !i || typeof i !== 'object' || Array.isArray(i))) fail(400, 'Savatni tekshiring.');
      if (new Set(input.items.map(i => i?.id)).size !== input.items.length) fail(400, 'Savatda takroriy taom bor.');
      const row = await db.prepare("SELECT * FROM businesses WHERE id=? AND kind='restaurant'").bind(restaurantId).first();
      if (!row) fail(404, 'Restoran topilmadi.');
      const s = JSON.parse(row.state);
      const prior = s.orders.find(o => o.requestId === requestId);
      if (prior) return json({ order: { id: prior.id, total: Core.total(prior), status: prior.status, restaurant: s.settings.name } });
      const branch = s.branches.find(b => b.id === input.branch && b.active);
      if (!branch || !operatingNow(s)) fail(409, 'Restoran hozir buyurtma qabul qilmayapti.');
      if (s.orders.length >= 3000) fail(409, 'Restoran buyurtmalar chegarasiga yetgan.');
      const items = input.items.map(i => {
        number(i.id, 1, Number.MAX_SAFE_INTEGER, true); number(i.qty, 1, 50, true);
        const p = s.menu.find(p => p.id === i.id && !p.stop);
        if (!p) fail(409, 'Taom hozir mavjud emas. Menyuni yangilang.');
        if (i.price !== p.price) fail(409, 'Taom narxi o‘zgargan. Sahifani yangilang.');
        return { name: p.name, qty: i.qty, price: p.price };
      });
      const now = Date.now(), order = { id: Math.max(0, ...s.orders.map(o => o.id)) + 1, requestId, customer, phone, address, note, branch: branch.id, type: 'Yetkazib berish', payment: 'Naqd', status: 'new', created: now, items };
      s.orders.unshift(order);
      const result = await db.prepare('UPDATE businesses SET state=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(JSON.stringify(s), now, row.id, row.revision).run();
      if (result.meta.changes !== 1) fail(409, 'Restoran ma’lumoti yangilandi. Qayta urinib ko‘ring.');
      return json({ order: { id: order.id, total: Core.total(order), status: order.status, restaurant: s.settings.name } }, 201);
    }
    const user = await currentUser(request, db, courier);
    if (!user) fail(401, 'Davom etish uchun hisobingizga kiring.');
    if (route === auth + '/me' && method === 'GET') return json({ user });
    if (courier) return await Courier.handleCourier(request, db, user, route, method);
    const ownerCourierResponse = await Courier.handleOwner(request, db, user, route, method);
    if (ownerCourierResponse) return ownerCourierResponse;
    if (route === '/api/businesses' && method === 'POST') {
      await limit(db, 'business:' + user.id, 30, 3600000);
      return json({ business: await createBusiness(db, user, await body(request)) }, 201);
    }
    if (route === '/api/businesses' && method === 'GET') {
      const { results } = await db.prepare('SELECT * FROM businesses WHERE owner_id=? ORDER BY updated_at DESC').bind(user.id).all();
      const since = Date.now() - 30 * 86400000;
      return json({ businesses: results.map(row => {
        const s = JSON.parse(row.state), completed = s.orders.filter(o => o.status === 'done' && (o.completed || o.created) >= since);
        return { ...businessInfo(row), sales: completed.reduce((sum, o) => sum + Core.total(o), 0), completed: completed.length, pending: s.orders.filter(o => ['new', 'preparing', 'ready'].includes(o.status)).length, branches: s.branches.length, activeBranches: s.branches.filter(b => b.active).length, products: s.menu.length, staff: s.staff.length };
      }) });
    }
    const match = route.match(/^\/api\/businesses\/([a-f0-9-]{36})\/state$/);
    if (match && ['GET', 'PUT'].includes(method)) {
      const row = await db.prepare('SELECT * FROM businesses WHERE id=? AND owner_id=?').bind(match[1], user.id).first();
      if (!row) fail(404, 'Biznes topilmadi.');
      if (method === 'GET') return json({ business: businessInfo(row), state: JSON.parse(row.state), ...await Courier.ownerData(db, row.id) });
      const input = await body(request);
      if (input.revision !== row.revision) fail(409, 'Boshqa oynada o‘zgarish bor. Sahifani yangilab qayta urinib ko‘ring.');
      let state;
      try { state = validateState(input.state, JSON.parse(row.state)); }
      catch (error) { if (error.status) throw error; fail(400, 'Kabinet ma’lumoti noto‘g‘ri.'); }
      const now = Date.now();
      // Protect dispatched orders in the SQL UPDATE too, including a dispatch racing this save.
      const previous = JSON.parse(row.state), changed = previous.orders.filter(old => state.orders.find(o => o.id === old.id)?.status !== old.status).map(o => o.id);
      const guard = changed.length ? " AND NOT EXISTS(SELECT 1 FROM deliveries WHERE business_id=? AND order_id IN (SELECT value FROM json_each(?)) AND status IN ('available','accepted','picked_up'))" : '';
      const result = await db.prepare('UPDATE businesses SET state=?,name=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?' + guard).bind(JSON.stringify(state), state.settings.name, now, row.id, user.id, input.revision, ...(changed.length ? [row.id, JSON.stringify(changed)] : [])).run();
      if (result.meta.changes !== 1) fail(409, 'Boshqa oynada o‘zgarish bor. Sahifani yangilang.');
      return json({ business: { ...businessInfo(row), name: state.settings.name, revision: row.revision + 1, updatedAt: now }, state, ...await Courier.ownerData(db, row.id) });
    }
    fail(404, 'Manzil topilmadi.');
  } catch (error) {
    if (!error.status) console.error('API error:', error.message);
    return json({ error: error.status ? error.message : 'Server xatosi. Qayta urinib ko‘ring.' }, error.status || 500);
  }
}
