export function createCourierRoutes({ fail, number, textValue, digest, random, json, body, limit, Core }) {
  const vehicles = ['bicycle', 'motorcycle', 'car', 'on_foot'];
  function profileValues(input) {
    const phone = textValue(input.phone, 30).replace(/[\s()-]/g, '');
    if (!/^\+998\d{9}$/.test(phone)) fail(400, 'Telefonni +998901234567 ko‘rinishida kiriting.');
    if (!vehicles.includes(input.vehicle)) fail(400, 'Transport turini tanlang.');
    return { phone, vehicle: input.vehicle, city: textValue(input.city, 80) };
  }
  const ownerDelivery = row => ({ id: row.id, orderId: row.order_id, courierId: row.courier_id, courierName: row.courier_name || '', courierPhone: row.courier_phone || '', status: row.status, fee: row.fee, createdAt: row.created_at, deliveredAt: row.delivered_at, issue: row.last_issue });
  async function ownerData(db, id) {
    const { results: couriers } = await db.prepare('SELECT c.id,c.name,c.phone,c.vehicle,c.online FROM courier_memberships m JOIN courier_accounts c ON c.id=m.courier_id WHERE m.business_id=? ORDER BY m.joined_at DESC').bind(id).all();
    const { results: deliveries } = await db.prepare('SELECT d.*,c.name AS courier_name,c.phone AS courier_phone FROM deliveries d LEFT JOIN courier_accounts c ON c.id=d.courier_id WHERE d.business_id=? ORDER BY d.created_at DESC LIMIT 100').bind(id).all();
    return { couriers, deliveries: deliveries.map(ownerDelivery) };
  }
  function courierDelivery(row, active = false) {
    const snapshot = JSON.parse(row.snapshot);
    return { id: row.id, businessId: row.business_id, orderId: row.order_id, businessName: snapshot.businessName, pickup: snapshot.pickup, status: row.status, fee: row.fee, createdAt: row.created_at, acceptedAt: row.accepted_at, pickedUpAt: row.picked_up_at, deliveredAt: row.delivered_at, ...(active ? { customer: snapshot.customer, items: snapshot.items, total: snapshot.total, payment: snapshot.payment, note: snapshot.note } : {}) };
  }
  async function dashboard(db, user) {
    const profile = await db.prepare('SELECT id,name,email,phone,vehicle,city,online FROM courier_accounts WHERE id=?').bind(user.id).first();
    const { results: partners } = await db.prepare('SELECT b.id,b.name,b.kind FROM courier_memberships m JOIN businesses b ON b.id=m.business_id WHERE m.courier_id=? ORDER BY b.name').bind(user.id).all();
    const { results: available } = profile.online ? await db.prepare("SELECT d.* FROM deliveries d JOIN courier_memberships m ON m.business_id=d.business_id WHERE m.courier_id=? AND d.status='available' ORDER BY d.created_at LIMIT 50").bind(user.id).all() : { results: [] };
    const { results: active } = await db.prepare("SELECT * FROM deliveries WHERE courier_id=? AND status IN ('accepted','picked_up') ORDER BY accepted_at").bind(user.id).all();
    const { results: history } = await db.prepare("SELECT * FROM deliveries WHERE courier_id=? AND status='delivered' ORDER BY delivered_at DESC LIMIT 50").bind(user.id).all();
    // Asia/Tashkent has a fixed UTC+05:00 offset.
    const today = Math.floor((Date.now() + 18000000) / 86400000) * 86400000 - 18000000;
    const stats = await db.prepare("SELECT COUNT(*) AS delivered,COALESCE(SUM(fee),0) AS earned,COALESCE(SUM(CASE WHEN delivered_at>=? THEN fee ELSE 0 END),0) AS todayEarned,COALESCE(SUM(CASE WHEN delivered_at>=? THEN 1 ELSE 0 END),0) AS todayDelivered FROM deliveries WHERE courier_id=? AND status='delivered'").bind(today, today, user.id).first();
    return json({ profile, partners, available: available.map(d => courierDelivery(d)), active: active.map(d => courierDelivery(d, true)), history: history.map(d => courierDelivery(d)), stats });
  }
  async function handleCourier(request, db, user, route, method) {
    if (route === '/api/courier/dashboard' && method === 'GET') return dashboard(db, user);
    if (route === '/api/courier/profile' && method === 'PUT') {
      const input = await body(request), values = profileValues(input), name = textValue(input.name, 100);
      if (typeof input.online !== 'boolean') fail(400, 'Ish holatini tanlang.');
      // The conditional UPDATE closes the race between going offline and accepting a job.
      const result = await db.prepare("UPDATE courier_accounts SET name=?,phone=?,vehicle=?,city=?,online=? WHERE id=? AND (?=1 OR NOT EXISTS(SELECT 1 FROM deliveries WHERE courier_id=? AND status IN ('accepted','picked_up')))").bind(name, values.phone, values.vehicle, values.city, input.online ? 1 : 0, user.id, input.online ? 1 : 0, user.id).run();
      if (result.meta.changes !== 1) fail(409, 'Avval faol yetkazishni yakunlang yoki olinmagan buyurtmani qaytaring.');
      return dashboard(db, user);
    }
    if (route === '/api/courier/join' && method === 'POST') {
      await limit(db, 'courier-join:' + user.id, 12, 900000);
      const input = await body(request), code = textValue(input.code, 40).toUpperCase().replace(/[-\s]/g, '');
      const hash = await digest(code), now = Date.now();
      // Authorization is checked in the INSERT itself so revoked/expired codes cannot race a join.
      const result = await db.prepare('INSERT INTO courier_memberships (business_id,courier_id,joined_at) SELECT business_id,?,? FROM courier_invites WHERE code_hash=? AND expires_at>? ON CONFLICT(business_id,courier_id) DO NOTHING').bind(user.id, now, hash, now).run();
      if (result.meta.changes !== 1) {
        const already = await db.prepare('SELECT 1 AS ok FROM courier_memberships m JOIN courier_invites i ON i.business_id=m.business_id WHERE m.courier_id=? AND i.code_hash=? AND i.expires_at>?').bind(user.id, hash, now).first();
        if (!already) fail(400, 'Taklif kodi noto‘g‘ri yoki muddati tugagan. Biznes egasidan yangi kod oling.');
      }
      return dashboard(db, user);
    }
    const match = route.match(/^\/api\/courier\/jobs\/([a-f0-9-]{36})\/(accept|pickup|deliver|release)$/);
    if (match && method === 'POST') {
      const [_, id, action] = match, now = Date.now();
      if (action === 'accept') {
        const result = await db.prepare("UPDATE deliveries SET courier_id=?,status='accepted',accepted_at=? WHERE id=? AND status='available' AND EXISTS(SELECT 1 FROM courier_memberships m WHERE m.business_id=deliveries.business_id AND m.courier_id=?) AND EXISTS(SELECT 1 FROM courier_accounts WHERE id=? AND online=1) AND NOT EXISTS(SELECT 1 FROM deliveries WHERE courier_id=? AND status IN ('accepted','picked_up'))").bind(user.id, now, id, user.id, user.id, user.id).run();
        if (result.meta.changes !== 1) fail(409, 'Buyurtma band, siz oflaynsiz yoki faol yetkazishingiz bor. Ro‘yxatni yangilang.');
      } else if (action === 'pickup') {
        const result = await db.prepare("UPDATE deliveries SET status='picked_up',picked_up_at=? WHERE id=? AND courier_id=? AND status='accepted'").bind(now, id, user.id).run();
        if (result.meta.changes !== 1) fail(409, 'Buyurtmani olib ketish holatiga o‘tkazib bo‘lmaydi.');
      } else if (action === 'release') {
        const input = await body(request), reason = textValue(input.reason, 500);
        const result = await db.prepare("UPDATE deliveries SET status='available',courier_id=NULL,accepted_at=NULL,last_issue=? WHERE id=? AND courier_id=? AND status='accepted'").bind(reason, id, user.id).run();
        if (result.meta.changes !== 1) fail(409, 'Olib ketilgan buyurtmani qaytarib bo‘lmaydi. Biznes bilan bog‘laning.');
      } else {
        const delivery = await db.prepare("SELECT * FROM deliveries WHERE id=? AND courier_id=? AND status='picked_up'").bind(id, user.id).first();
        if (!delivery) fail(409, 'Avval buyurtmani olib ketganingizni belgilang.');
        const business = await db.prepare('SELECT * FROM businesses WHERE id=?').bind(delivery.business_id).first();
        const state = JSON.parse(business.state), index = state.orders.findIndex(o => o.id === delivery.order_id);
        if (index < 0 || state.orders[index].status !== 'ready') fail(409, 'Buyurtma holati o‘zgargan. Biznes bilan bog‘laning.');
        state.orders[index] = { ...Core.transition(state.orders[index], 'done'), completed: now };
        // Both writes commit atomically. Each is guarded by the same order, assignment and revision.
        const results = await db.batch([
          db.prepare("UPDATE businesses SET state=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM deliveries WHERE id=? AND courier_id=? AND status='picked_up')").bind(JSON.stringify(state), now, business.id, business.revision, id, user.id),
          db.prepare("UPDATE deliveries SET status='delivered',delivered_at=? WHERE id=? AND courier_id=? AND status='picked_up' AND EXISTS(SELECT 1 FROM businesses WHERE id=? AND revision=? AND json_extract(state,?)='done' AND json_extract(state,?)=?)").bind(now, id, user.id, business.id, business.revision + 1, '$.orders[' + index + '].status', '$.orders[' + index + '].completed', now)
        ]);
        if (results.some(r => r.meta.changes !== 1)) fail(409, 'Buyurtma boshqa oynada yangilandi. Qayta urinib ko‘ring.');
      }
      return dashboard(db, user);
    }
    fail(404, 'Kuryer bo‘limi topilmadi.');
  }
  async function handleOwner(request, db, user, route, method) {
    const match = route.match(/^\/api\/businesses\/([a-f0-9-]{36})\/(couriers(?:\/[a-f0-9-]{36}\/remove)?|courier-invite|deliveries(?:\/[a-f0-9-]{36}\/cancel)?)$/);
    if (!match) return null;
    const [, id, action] = match;
    const business = await db.prepare('SELECT * FROM businesses WHERE id=? AND owner_id=?').bind(id, user.id).first();
    if (!business) fail(404, 'Biznes topilmadi.');
    if (action === 'couriers' && method === 'GET') return json(await ownerData(db, id));
    if (action === 'courier-invite' && method === 'POST') {
      await limit(db, 'courier-invite:' + id, 20, 3600000);
      const raw = 'BG' + random().slice(0, 16).toUpperCase(), expiresAt = Date.now() + 7 * 86400000;
      await db.prepare('INSERT INTO courier_invites (business_id,code_hash,expires_at) VALUES (?,?,?) ON CONFLICT(business_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at').bind(id, await digest(raw), expiresAt).run();
      return json({ code: 'BG-' + raw.slice(2).match(/.{4}/g).join('-'), expiresAt });
    }
    if (action.startsWith('couriers/') && method === 'POST') {
      const courierId = action.split('/')[1];
      const results = await db.batch([
        db.prepare("DELETE FROM courier_invites WHERE business_id=? AND EXISTS(SELECT 1 FROM courier_memberships WHERE business_id=? AND courier_id=?) AND NOT EXISTS(SELECT 1 FROM deliveries WHERE business_id=? AND courier_id=? AND status IN ('accepted','picked_up'))").bind(id, id, courierId, id, courierId),
        db.prepare("DELETE FROM courier_memberships WHERE business_id=? AND courier_id=? AND NOT EXISTS(SELECT 1 FROM deliveries WHERE business_id=? AND courier_id=? AND status IN ('accepted','picked_up'))").bind(id, courierId, id, courierId)
      ]);
      const result = results[1];
      if (result.meta.changes !== 1) fail(409, 'Kuryer topilmadi yoki faol yetkazishi bor.');
      return json(await ownerData(db, id));
    }
    if (action === 'deliveries' && method === 'POST') {
      const input = await body(request), orderId = number(input.orderId, 1, Number.MAX_SAFE_INTEGER, true), fee = number(input.fee, 0, 1000000, true);
      const state = JSON.parse(business.state), order = state.orders.find(o => o.id === orderId), branch = state.branches.find(b => b.id === order?.branch);
      if (!order || order.status !== 'ready' || order.type !== 'Yetkazib berish') fail(400, 'Faqat tayyor yetkazib berish buyurtmasi chiqariladi.');
      if (!order.address?.trim() || !order.phone?.trim()) fail(400, 'Buyurtmada mijoz telefoni va yetkazish manzili bo‘lishi kerak.');
      if (!branch?.address?.trim() || branch.address === 'Manzilni sozlamalarda kiriting') fail(400, 'Avval Ish vaqti bo‘limida filialning haqiqiy manzilini kiriting.');
      const snapshot = { businessName: business.name, pickup: { name: branch.name, address: branch.address, phone: state.settings.phone || '' }, customer: { name: order.customer, phone: order.phone, address: order.address }, items: order.items, total: Core.total(order), payment: order.payment, note: order.note || '' };
      // If an owner completed the order concurrently, the revision check prevents dispatch.
      const result = await db.prepare("INSERT INTO deliveries (id,business_id,order_id,fee,snapshot,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM businesses WHERE id=? AND revision=?) ON CONFLICT(business_id,order_id) DO UPDATE SET status='available',fee=excluded.fee,snapshot=excluded.snapshot,created_at=excluded.created_at WHERE deliveries.status='cancelled'").bind(crypto.randomUUID(), id, orderId, fee, JSON.stringify(snapshot), Date.now(), id, business.revision).run();
      if (result.meta.changes !== 1) fail(409, 'Buyurtma allaqachon chiqarilgan yoki o‘zgargan. Ro‘yxatni yangilang.');
      return json(await ownerData(db, id), 201);
    }
    if (action.startsWith('deliveries/') && method === 'POST') {
      const deliveryId = action.split('/')[1];
      const result = await db.prepare("UPDATE deliveries SET status='cancelled' WHERE id=? AND business_id=? AND status='available'").bind(deliveryId, id).run();
      if (result.meta.changes !== 1) fail(409, 'Kuryer olgan buyurtmani bekor qilib bo‘lmaydi.');
      return json(await ownerData(db, id));
    }
    fail(405, 'So‘rov usuli qo‘llanmaydi.');
  }
  return { profileValues, ownerData, handleCourier, handleOwner };
}
