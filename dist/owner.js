(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const kinds = { restaurant: 'Restoran / kafe', shop: 'Do‘kon', service: 'Xizmat ko‘rsatish', other: 'Boshqa biznes' };
  const API = window.OwnerAPI = { user: null, businesses: [], business: null, kinds };
  API.request = async (path, data, method = 'POST') => {
    let response;
    try {
      response = await fetch('/api' + path, { method: data === undefined ? 'GET' : method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Birga-Request': '1' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    } catch { throw Error('Serverga ulanib bo‘lmadi. Internetni tekshirib qayta urinib ko‘ring.'); }
    let result;
    try { result = await response.json(); } catch { throw Error('Server javobi noto‘g‘ri. Qayta urinib ko‘ring.'); }
    if (!response.ok) throw Object.assign(new Error(result.error || 'So‘rov bajarilmadi.'), { status: response.status });
    return result;
  };
  API.refresh = async () => { API.businesses = (await API.request('/businesses')).businesses; };
  API.remember = id => { try { sessionStorage.setItem('birga.business.' + API.user.id, id); } catch {} };
  API.open = async (id, view = 'orders') => {
    const result = await API.request('/businesses/' + id + '/state');
    API.business = result.business;
    API.remember(id);
    API.updateSwitcher();
    window.dispatchEvent(new CustomEvent('birga:business', { detail: { ...result, view } }));
  };
  API.restore = async () => {
    let selected = null;
    try { selected = sessionStorage.getItem('birga.business.' + API.user.id); } catch {}
    const business = API.businesses.find(b => b.id === selected) || (selected === null && API.businesses.length === 1 ? API.businesses[0] : null);
    if (business) await API.open(business.id, 'overview');
  };
  API.choose = async view => {
    if (API.businesses.length === 1) return API.open(API.businesses[0].id, view);
    const dialog = $('#choose-business'), list = $('#choose-business-list');
    list.replaceChildren();
    $('#choose-business-message').textContent = API.businesses.length ? 'Bu bo‘lim qaysi biznes uchun ochilsin?' : 'Bu bo‘limdan foydalanish uchun avval biznes qo‘shing.';
    $('#choose-business-title').textContent = API.businesses.length ? 'Biznesni tanlang' : 'Birinchi biznesingizni qo‘shing';
    $('#choose-business-error').textContent = '';
    for (const business of API.businesses) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'business-choice'; button.dataset.businessId = business.id;
      const title = document.createElement('b'), kind = document.createElement('small');
      title.textContent = business.name; kind.textContent = API.kinds[business.kind] + ' · Ochish →';
      button.append(title, kind);
      button.onclick = async () => {
        list.querySelectorAll('button').forEach(b => b.disabled = true);
        try { await API.open(business.id, view); API.pendingView = null; dialog.close(); }
        catch (error) { $('#choose-business-error').textContent = error.message; }
        finally { list.querySelectorAll('button').forEach(b => b.disabled = false); }
      };
      list.append(button);
    }
    API.pendingView = view;
    dialog.showModal();
  };
  API.save = async state => {
    if (!API.business) throw Error('Avval biznesni tanlang.');
    const result = await API.request('/businesses/' + API.business.id + '/state', { revision: API.business.revision, state }, 'PUT');
    API.business = result.business;
    API.updateSwitcher();
    return result.state;
  };
  API.updateSwitcher = () => {
    const select = $('#business-select');
    select.replaceChildren(new Option('Barcha bizneslar', ''));
    for (const b of API.businesses) select.add(new Option(API.business?.id === b.id ? API.business.name : b.name, b.id));
    select.value = API.business?.id || '';
  };
  API.failure = error => {
    $('#boot-error').hidden = false;
    $('#boot-error p').textContent = error.message;
    $('#boot-error button').onclick = () => location.reload();
  };
  API.ready = async () => {
    let user;
    try { user = (await API.request('/auth/me')).user; }
    catch (error) {
      if (error.status !== 401) throw error;
      $('#auth-screen').hidden = false;
      user = await new Promise(resolve => {
        let register = false;
        $('#auth-toggle').onclick = () => {
          register = !register;
          $('#auth-name-field').hidden = !register;
          $('#auth-form').elements.name.required = register;
          $('#auth-form').elements.password.minLength = register ? 10 : 1;
          $('#auth-form').elements.password.autocomplete = register ? 'new-password' : 'current-password';
          $('#auth-title').textContent = register ? 'Bizneslaringiz shu yerdan boshlanadi.' : 'Bizneslaringizga xush kelibsiz.';
          $('#auth-submit').textContent = register ? 'Hisob yaratish' : 'Kabinetga kirish';
          $('#auth-toggle').textContent = register ? 'Hisobim bor — kirish' : 'Yangi hisob yaratish';
          $('#auth-error').textContent = '';
        };
        $('#auth-form').onsubmit = async event => {
          event.preventDefault(); const button = $('#auth-submit'); button.disabled = true; $('#auth-error').textContent = '';
          try {
            const data = Object.fromEntries(new FormData(event.target));
            const result = await API.request(register ? '/auth/register' : '/auth/login', data);
            resolve(result.user);
          } catch (error) { $('#auth-error').textContent = error.message; }
          finally { button.disabled = false; }
        };
      });
    }
    API.user = user;
    $('#auth-screen').hidden = true;
    await API.refresh();
    $('#owner-name').textContent = user.name;
    $('#owner-initial').textContent = user.name[0].toUpperCase();
    API.updateSwitcher();
    $('#business-select').onchange = async event => {
      const id = event.target.value;
      event.target.disabled = true;
      try {
        if (id) await API.open(id);
        else {
          await API.refresh(); API.business = null; API.remember(''); API.updateSwitcher();
          window.dispatchEvent(new CustomEvent('birga:overview'));
        }
      } catch (error) { alert(error.message); API.updateSwitcher(); }
      finally { event.target.disabled = false; }
    };
    $('#logout-button').onclick = async () => {
      try { await API.request('/auth/logout', {}); location.reload(); }
      catch (error) { alert(error.message); }
    };
    $('#create-business-form').onsubmit = async event => {
      event.preventDefault(); const button = event.target.querySelector('[type=submit]'); button.disabled = true; $('#business-error').textContent = '';
      try {
        const result = await API.request('/businesses', Object.fromEntries(new FormData(event.target)));
        await API.refresh(); await API.open(result.business.id, API.pendingView || 'orders'); API.pendingView = null;
        $('#business-editor').close(); event.target.reset();
      } catch (error) { $('#business-error').textContent = error.message; }
      finally { button.disabled = false; }
    };
    $('#cancel-business').onclick = () => $('#business-editor').close();
    $('#cancel-choose-business').onclick = () => { $('#choose-business').close(); API.pendingView = null; };
    $('#choose-create-business').onclick = () => API.create();
    $('#app-shell').hidden = false;
    return { user };
  };
  API.create = () => { $('#choose-business').close(); $('#business-error').textContent = ''; $('#business-editor').showModal(); };
})();
