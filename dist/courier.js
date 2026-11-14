(async () => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => new Intl.NumberFormat('uz-UZ').format(n || 0) + ' so‘m';
  const date = n => new Date(n).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const vehicles = { bicycle: 'Velosiped', motorcycle: 'Moto / skuter', car: 'Avtomobil', on_foot: 'Piyoda' };
  let data, view = 'jobs', busy = false, refreshing = false, actionSubmit, toastTimer;
  async function api(path, payload, method = 'POST') {
    let response;
    try { response = await fetch('/api/courier' + path, { method: payload === undefined ? 'GET' : method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Birga-Request': '1' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }); }
    catch { throw Error('Serverga ulanib bo‘lmadi. Internetni tekshiring.'); }
    let result; try { result = await response.json(); } catch { throw Error('Server javobini o‘qib bo‘lmadi. Qayta urinib ko‘ring.'); }
    if (!response.ok) throw Object.assign(new Error(result.error || 'So‘rov bajarilmadi.'), { status: response.status });
    return result;
  }
  function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4500); }
  async function mutate(path, payload = {}, method = 'POST') {
    if (busy || refreshing) throw Error('Avvalgi so‘rov yakunlanmoqda.');
    busy = true; document.body.classList.add('busy');
    try { const result = await api(path, payload, method); data = result; render(); return result; }
    finally { busy = false; document.body.classList.remove('busy'); }
  }
  async function refresh(silent = false) {
    if (busy || refreshing) return;
    refreshing = true; $('#refresh-button').disabled = true;
    try { data = await api('/dashboard'); render(); if (!silent) toast('Ma’lumotlar yangilandi.'); }
    catch (error) { toast(error.message); }
    finally { refreshing = false; $('#refresh-button').disabled = false; }
  }
  function heading(title, description, action = '') { return `<div class="page-heading"><div><span class="eyebrow">BIRGA · KURYER UCHUN</span><h1>${title}<span>✳</span></h1><p>${description}</p></div>${action}</div>`; }
  function empty(title, description, button = '') { return `<section class="empty panel"><span>↗</span><h2>${title}</h2><p>${description}</p>${button}</section>`; }
  const joinButton = '<button class="secondary" data-action="join">+ Biznesga ulanish</button>';
  function stats() { return `<div class="stats"><article><span>Bugungi yetkazishlar<i>✓</i></span><strong>${data.stats.todayDelivered}</strong><small>Mijozga topshirilgan</small></article><article><span>Bugungi hisoblangan haq<i>↗</i></span><strong>${money(data.stats.todayEarned)}</strong><small>Yakunlangan yetkazishlar uchun</small></article><article><span>Hamkor bizneslar<i>◈</i></span><strong>${data.partners.length}</strong><small>Taklif orqali ulangan</small></article></div>`; }
  function mapLink(address) { return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`; }
  function callLink(phone, label) { const number = String(phone).replace(/[^+\d]/g, ''); return number ? `<a class="secondary" href="tel:${esc(number)}">☎ ${label}</a>` : ''; }
  function jobCard(job) { return `<article class="panel job-card"><div class="job-top"><span class="job-id">#${job.orderId} · Yetkazish</span><span class="status available">Yangi</span></div><h2>${esc(job.businessName)}</h2><div class="pickup"><span>A</span><div><small>Olib ketish manzili</small><b>${esc(job.pickup.address)}</b><p>${esc(job.pickup.name)}</p></div></div><p class="privacy-note">Mijoz manzili buyurtmani olganingizdan so‘ng ko‘rinadi.</p><div class="job-bottom"><div><small>Yetkazish haqi</small><strong>${money(job.fee)}</strong></div><button class="primary" data-action="accept" data-id="${job.id}" ${data.active.length ? 'disabled' : ''}>Buyurtmani olish ↗</button></div></article>`; }
  function jobs() {
    const online = !!data.profile.online;
    return heading('Buyurtmalar', 'Hamkorlaringizdan yetkazishga tayyor buyurtmalar.', joinButton) + `<section class="welcome"><div><span class="status ${online ? 'available' : 'offline'}">● ${online ? 'Siz onlaynsiz' : 'Siz oflaynsiz'}</span><h2>${online ? 'Yaxshi kun. Yaxshi yo‘l.' : 'Yo‘lga tayyormisiz?'}</h2><p>Salom, ${esc(data.profile.name.split(' ')[0])}. ${online ? 'Buyurtmalarni oling, biz birga yetkazamiz.' : 'Ishni boshlang va hamkor bizneslar buyurtmalarini ko‘ring.'}</p><button class="${online ? 'secondary' : 'primary'}" data-action="${online ? 'show-active' : 'online'}">${online ? 'Faol yetkazishga o‘tish ↗' : 'Ishni boshlash →'}</button></div><div class="route-art" aria-hidden="true"><span>A</span><i></i><b>↗</b><span>B</span></div></section>` + stats() + (data.active.length ? `<section class="active-banner"><span>↗</span><div><b>Yetkazishingiz jarayonda</b><p>Yangi buyurtma olishdan avval hozirgisini yakunlang.</p></div><button class="primary" data-view="active">Davom etish</button></section>` : '') + `<div class="section-heading"><h2>Mavjud buyurtmalar <span>${data.available.length}</span></h2><small>${data.partners.length} ta hamkor biznes</small></div>` + (!data.partners.length ? empty('Birinchi hamkoringizga ulaning', 'Biznes egasidan taklif kodi oling. Ulangach, uning yetkazishga chiqarilgan buyurtmalari shu yerda ko‘rinadi.', joinButton) : !online ? empty('Buyurtmalar uchun ishni boshlang', 'Onlayn bo‘lganingizda hamkorlaringizning tayyor buyurtmalari ko‘rinadi.', '<button class="primary" data-action="online">Ishni boshlash →</button>') : data.available.length ? `<div class="job-grid">${data.available.map(jobCard).join('')}</div>` : empty('Hozircha yangi buyurtma yo‘q', 'Biznes egasi tayyor buyurtmani kuryerga chiqarganda shu yerda paydo bo‘ladi.', '<button class="secondary" data-action="refresh">↻ Yangilash</button>'));
  }
  function active() {
    if (!data.active.length) return heading('Faol yetkazish', 'Har bir manzil nazoratda.') + empty('Faol yetkazishingiz yo‘q', 'Buyurtmalar bo‘limidan birinchi yetkazishingizni oling.', '<button class="primary" data-view="jobs">Buyurtmalarni ko‘rish →</button>');
    const job = data.active[0], picked = job.status === 'picked_up';
    return heading('Faol yetkazish', `Buyurtma #${job.orderId} · ${esc(job.businessName)}`) + `<div class="delivery-layout"><section class="panel delivery-detail"><div class="panel-heading"><h2>${picked ? 'Mijoz sari yo‘ldasiz' : 'Buyurtmani olib ketish'}</h2><span class="status available">${picked ? 'Yo‘lda' : 'Qabul qilindi'}</span></div><div class="steps"><span class="complete">✓ Qabul qilindi</span><i></i><span class="${picked ? 'complete' : ''}">${picked ? '✓' : '2'} Olib ketish</span><i></i><span>3 Yetkazish</span></div><div class="route-point"><span>A</span><div><small>OLIB KETISH</small><h3>${esc(job.businessName)} · ${esc(job.pickup.name)}</h3><p>${esc(job.pickup.address)}</p><div class="button-row"><a class="secondary" href="${esc(mapLink(job.pickup.address))}" target="_blank" rel="noreferrer">↗ Xaritada ochish</a>${callLink(job.pickup.phone, 'Biznesga qo‘ng‘iroq')}</div></div></div><div class="route-point destination"><span>B</span><div><small>YETKAZISH</small><h3>${esc(job.customer.name)}</h3><p>${esc(job.customer.address)}</p><div class="button-row"><a class="secondary" href="${esc(mapLink(job.customer.address))}" target="_blank" rel="noreferrer">↗ Xaritada ochish</a>${callLink(job.customer.phone, 'Mijozga qo‘ng‘iroq')}</div></div></div>${job.note ? `<div class="order-note"><b>Mijoz izohi</b><p>${esc(job.note)}</p></div>` : ''}<div class="delivery-action"><button class="primary" data-action="${picked ? 'deliver' : 'pickup'}" data-id="${job.id}">${picked ? '✓ Mijozga yetkazdim' : '✓ Buyurtmani oldim'}</button>${!picked ? `<button class="text-button" data-action="release" data-id="${job.id}">Buyurtmani qaytarish</button>` : ''}</div></section><aside class="panel order-summary"><span class="eyebrow">BUYURTMA #${job.orderId}</span><h2>Buyurtma tarkibi</h2>${job.items.map(item => `<div class="summary-item"><span>${item.qty} × ${esc(item.name)}</span><b>${money(item.qty * item.price)}</b></div>`).join('')}<div class="summary-total"><span>Buyurtma summasi</span><strong>${money(job.total)}</strong></div><p class="payment-note">To‘lov usuli: <b>${esc(job.payment)}</b>. ${job.payment === 'Naqd' ? 'Naqd pulni qabul qilishni biznes bilan kelishib oling.' : 'Bank to‘lov holati bu kabinetda tasdiqlanmaydi.'}</p><div class="courier-fee"><small>Sizga hisoblanadigan haq</small><strong>${money(job.fee)}</strong><p>Yetkazish yakunlanganda hisoblanadi.</p></div></aside></div>`;
  }
  function earnings() { return heading('Daromad', 'Yakunlangan yetkazishlar va hisoblangan haq.') + `<div class="stats"><article><span>Jami hisoblangan haq<i>↗</i></span><strong>${money(data.stats.earned)}</strong><small>${data.stats.delivered} ta yetkazish uchun</small></article><article><span>Bugungi haq<i>☀</i></span><strong>${money(data.stats.todayEarned)}</strong><small>Toshkent vaqti bo‘yicha</small></article><article><span>Bugungi yetkazishlar<i>✓</i></span><strong>${data.stats.todayDelivered}</strong><small>Mijozga topshirilgan</small></article></div><p class="info-note">Bu yerda hisoblangan haq ko‘rsatiladi. Bankka pul chiqarish hali ulanmagan; hisob-kitobni hamkor biznes bilan amalga oshiring.</p><section class="panel"><div class="panel-heading"><h2>Yetkazishlar tarixi</h2><small>Oxirgi 50 ta</small></div>${data.history.length ? `<div class="history-list">${data.history.map(job => `<article><span class="history-icon">✓</span><div><b>${esc(job.businessName)} · #${job.orderId}</b><small>${date(job.deliveredAt)}</small></div><strong>+${money(job.fee)}</strong></article>`).join('')}</div>` : '<div class="inside-empty">Birinchi yetkazishingizdan so‘ng tarix shu yerda ko‘rinadi.</div>'}</section>`; }
  function profile() { const p = data.profile; return heading('Profil va hamkorlar', 'Aloqa ma’lumotlaringiz va ulangan bizneslar.') + `<div class="profile-layout"><section class="panel"><div class="panel-heading"><h2>Kuryer profili</h2><span class="status ${p.online ? 'available' : 'offline'}">${p.online ? 'Onlayn' : 'Oflayn'}</span></div><form id="profile-form" class="profile-form"><label>Ism va familiya<input name="name" required maxlength="100" value="${esc(p.name)}" autocomplete="name"></label><label>Telefon<input name="phone" type="tel" required maxlength="30" value="${esc(p.phone)}" autocomplete="tel"></label><div class="form-grid"><label>Transport<select name="vehicle">${Object.entries(vehicles).map(([value, label]) => `<option value="${value}" ${p.vehicle === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Shahar<input name="city" required maxlength="80" value="${esc(p.city)}" autocomplete="address-level2"></label></div><p class="muted">Hisob: ${esc(p.email)}</p><div class="button-row"><button class="primary" type="submit">O‘zgarishlarni saqlash</button><button type="button" class="text-button" data-action="logout">Hisobdan chiqish ↗</button></div><p id="profile-error" class="error" role="alert"></p></form></section><section class="panel"><div class="panel-heading"><h2>Hamkor bizneslar</h2><span class="tag">${data.partners.length}</span></div><div class="partner-list">${data.partners.map(b => `<article><span>◈</span><div><b>${esc(b.name)}</b><small>Taklif orqali ulangan</small></div><i>✓</i></article>`).join('') || '<p class="muted">Hozircha hamkor biznes yo‘q.</p>'}</div><div class="panel-bottom">${joinButton}<p class="muted">Yangi hamkor biznesning taklif kodi bilan ulaning.</p></div></section></div>`; }
  function render() {
    const p = data.profile;
    $('#rider-name').textContent = p.name; $('#rider-initial').textContent = p.name[0]; $('#rider-vehicle').textContent = vehicles[p.vehicle] + ' · ' + p.city;
    $('#header-date').textContent = new Date().toLocaleDateString('uz-UZ', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'long' }) + ' · ' + p.city;
    $('#online-button').classList.toggle('on', !!p.online); $('#online-button').setAttribute('aria-pressed', String(!!p.online)); $('#online-button b').textContent = p.online ? 'Onlayn' : 'Ishni boshlash';
    $('#available-count').textContent = data.available.length; $('#active-count').textContent = data.active.length;
    document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('selected', button.dataset.view === view); button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false'); });
    $('#page-content').innerHTML = ({ jobs, active, earnings, profile })[view]();
    if ($('#profile-form')) $('#profile-form').onsubmit = async event => {
      event.preventDefault(); $('#profile-error').textContent = '';
      try { await mutate('/profile', { ...Object.fromEntries(new FormData(event.target)), online: !!data.profile.online }, 'PUT'); toast('Profil saqlandi.'); }
      catch (error) { if ($('#profile-error')) $('#profile-error').textContent = error.message; }
    };
  }
  function confirmAction(title, fields, submit) { $('#action-title').textContent = title; $('#action-fields').innerHTML = fields; $('#action-error').textContent = ''; actionSubmit = submit; $('#action-dialog').showModal(); }
  async function online() { await mutate('/profile', { ...data.profile, online: !data.profile.online }, 'PUT'); toast(data.profile.online ? 'Siz onlaynsiz. Yaxshi yo‘l!' : 'Ish to‘xtatildi. Yaxshi dam oling!'); }
  document.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || busy) return;
    try {
      if (button.dataset.close) { $('#' + button.dataset.close).close(); return; }
      if (button.dataset.view) { view = button.dataset.view; render(); window.scrollTo({ top: 0 }); return; }
      const action = button.dataset.action, id = button.dataset.id;
      if (action === 'logout') { await api('/auth/logout', {}); location.reload(); return; }
      if (action === 'join') { $('#join-error').textContent = ''; $('#join-dialog').showModal(); }
      if (action === 'online') await online();
      if (action === 'refresh') await refresh();
      if (action === 'show-active') { view = 'active'; render(); }
      if (action === 'accept') { await mutate('/jobs/' + id + '/accept'); view = 'active'; render(); window.scrollTo({ top: 0 }); toast('Buyurtma sizga biriktirildi.'); }
      if (action === 'pickup') { await mutate('/jobs/' + id + '/pickup'); toast('Buyurtma olindi. Mijoz sari yo‘lga chiqing.'); }
      if (action === 'deliver') confirmAction('Mijozga topshirildimi?', '<p>Buyurtmani mijozga topshirganingizdan so‘ng tasdiqlang. Yetkazish yakunlanadi va haq hisoblanadi.</p>', async () => { await mutate('/jobs/' + id + '/deliver'); view = 'earnings'; render(); toast('Yetkazildi! Mehnatingiz uchun rahmat.'); });
      if (action === 'release') confirmAction('Buyurtmani qaytarish', '<p>Hali olib ketilmagan buyurtma boshqa kuryerlar uchun qayta ochiladi.</p><label>Qaytarish sababi<textarea name="reason" required maxlength="500" rows="3"></textarea></label>', async form => { await mutate('/jobs/' + id + '/release', { reason: form.get('reason') }); view = 'jobs'; render(); toast('Buyurtma qaytarildi.'); });
    } catch (error) { toast(error.message); if (error.status === 409) await refresh(true); }
  });
  $('#action-form').onsubmit = async event => { event.preventDefault(); try { await actionSubmit(new FormData(event.target)); $('#action-dialog').close(); } catch (error) { $('#action-error').textContent = error.message; } };
  $('#join-form').onsubmit = async event => { event.preventDefault(); $('#join-error').textContent = ''; try { await mutate('/join', Object.fromEntries(new FormData(event.target))); $('#join-dialog').close(); event.target.reset(); toast('Biznesga muvaffaqiyatli ulandingiz.'); } catch (error) { $('#join-error').textContent = error.message; } };
  $('#refresh-button').onclick = () => refresh(); $('#online-button').onclick = async () => { try { await online(); } catch (error) { toast(error.message); } };
  $('#logout-button').onclick = async () => { try { await api('/auth/logout', {}); location.reload(); } catch (error) { toast(error.message); } };
  try { await api('/auth/me'); }
  catch (error) {
    if (error.status !== 401) throw error;
    $('#courier-auth').hidden = false;
    await new Promise(resolve => {
      let signup = false;
      $('#auth-toggle').onclick = () => {
        signup = !signup; $('#signup-fields').hidden = !signup;
        for (const name of ['name', 'phone', 'city']) $('#courier-auth-form').elements[name].required = signup;
        $('#courier-auth-form').elements.password.minLength = signup ? 10 : 1;
        $('#courier-auth-form').elements.password.autocomplete = signup ? 'new-password' : 'current-password';
        $('#auth-heading').textContent = signup ? 'BIRGA jamoasiga qo‘shiling.' : 'Yana yo‘lga chiqamizmi?';
        $('#auth-caption').textContent = signup ? 'Kuryer hisobingizni yarating. Parol kamida 10 belgidan iborat bo‘lsin.' : 'Davom etish uchun kuryer hisobingizga kiring.';
        $('#auth-submit').textContent = signup ? 'Hisob yaratish →' : 'Kabinetga kirish →';
        $('#auth-toggle').textContent = signup ? 'Hisobim bor — kirish' : 'Kuryer hisobini yaratish'; $('#auth-error').textContent = '';
      };
      $('#courier-auth-form').onsubmit = async event => {
        event.preventDefault(); $('#auth-submit').disabled = true; $('#auth-error').textContent = '';
        try { await api(signup ? '/auth/register' : '/auth/login', Object.fromEntries(new FormData(event.target))); resolve(); }
        catch (error) { $('#auth-error').textContent = error.message; }
        finally { $('#auth-submit').disabled = false; }
      };
    });
  }
  data = await api('/dashboard'); $('#courier-auth').hidden = true; $('#courier-app').hidden = false; render();
  setInterval(() => { if (document.visibilityState === 'visible' && view !== 'profile' && !document.querySelector('dialog[open]')) refresh(true); }, 20000);
})().catch(error => { document.querySelector('#load-error').hidden = false; document.querySelector('#load-error p').textContent = error.message; });
