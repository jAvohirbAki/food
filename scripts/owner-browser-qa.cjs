const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createApp } = require('../serve.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const artifacts = path.join(__dirname, '../.qa'); await fs.mkdir(artifacts, { recursive: true });
  const server = await createApp({ databasePath: ':memory:' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const profile = await fs.mkdtemp(path.join(artifacts, 'owner-browser-'));
  const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox', '--disable-extensions', '--disable-background-networking', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let ws;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = ''; const timeout = setTimeout(() => reject(Error('Browser launch timeout: ' + output.slice(-250))), 15000);
      browser.stderr.on('data', data => { output += data; const match = output.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
      browser.on('error', reject); browser.on('exit', code => { clearTimeout(timeout); reject(Error('Browser exited ' + code)); });
    });
    ws = new WebSocket(endpoint); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let sequence = 0; const pending = new Map(), errors = [];
    ws.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.id) { const item = pending.get(data.id); if (item) { pending.delete(data.id); data.error ? item.reject(Error(data.error.message)) : item.resolve(data.result); } }
      else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
    };
    function call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++sequence, timeout = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 10000);
        pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    }
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    const send = (m, p) => call(m, p, sessionId);
    await send('Runtime.enable'); await send('Page.enable');
    async function evaluate(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    }
    async function until(expression, message = expression) {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(70); }
      throw Error('Timed out: ' + message + '\n' + await evaluate("document.body.innerText.slice(-1200)"));
    }
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    async function fill(selector, values) {
      await evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(selector)});for(const [key,value] of Object.entries(${JSON.stringify(values)}))f.elements[key].value=value;f.requestSubmit()})()`);
    }
    async function submit(values) {
      await fill('#editor-form', values);
      await until("!document.querySelector('#editor').open || document.querySelector('#editor-error').textContent", 'editor save');
      assert.equal(await evaluate("document.querySelector('#editor-error').textContent"), '');
      assert.equal(await evaluate("document.querySelector('#save-status').textContent"), 'Bazada saqlandi');
    }
    async function createBusiness(name, kind) {
      await click('#page-action');
      await fill('#create-business-form', { name, kind });
      await until("!document.querySelector('#business-editor').open || document.querySelector('#business-error').textContent", 'business creation');
      assert.equal(await evaluate("document.querySelector('#business-error').textContent"), '');
      assert.equal(await evaluate('OwnerAPI.business.name'), name);
      return evaluate('OwnerAPI.business.id');
    }
    const view = async name => {
      await click(`[data-view="${name}"]`);
      await until(`document.querySelector('[data-view="${name}"]').getAttribute('aria-current')==='page'`);
    };
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: base + '/admin.html' });
    await until("!document.querySelector('#auth-screen')?.hidden");
    await click('#auth-toggle');
    await fill('#auth-form', { name: 'Dilshod Karimov', email: 'owner-qa@example.com', password: 'OwnerQaPassword-2026' });
    await until("document.querySelectorAll('#navigation button').length===11", 'owner dashboard');
    assert.ok(await evaluate("document.querySelector('.portfolio-empty').textContent.includes('Birinchi biznes')"));
    assert.equal(await evaluate("document.querySelectorAll('#navigation button:disabled').length"), 0);
    await click('[data-view="orders"]');
    await until("document.querySelector('#choose-business').open");
    assert.ok(await evaluate("document.querySelector('#choose-business-message').textContent.includes('avval biznes qo‘shing')"));
    await click('#cancel-choose-business');
    const restaurant = await createBusiness('Rayhon Kitchen', 'restaurant');
    assert.equal(await evaluate("document.querySelectorAll('.order-card').length"), 0);
    // A single business opens the requested panel automatically.
    await evaluate("(()=>{const select=document.querySelector('#business-select');select.value='';return select.onchange({target:select})})()");
    assert.equal(await evaluate('OwnerAPI.business'), null);
    await view('menu');
    assert.equal(await evaluate('OwnerAPI.business.id'), restaurant);
    assert.equal(await evaluate("document.querySelector('#choose-business').open"), false);
    await view('menu'); await click('#page-action');
    await submit({ name: 'To‘y oshi', cat: 'Milliy taomlar', price: 38000, img: '', modifiers: 'Salat +8000' });
    assert.ok(await evaluate("document.querySelector('#content').textContent.includes('To‘y oshi')"));
    await view('hours');
    await evaluate("(()=>{const f=document.querySelector('#hours-form');for(let i=0;i<7;i++){f.elements['open'+i].value='00:00';f.elements['close'+i].value='23:59'}f.requestSubmit()})()");
    await until("document.querySelector('#save-status').textContent==='Bazada saqlandi' && !document.body.classList.contains('saving')");
    await view('orders'); await click('#page-action');
    await submit({ customer: 'Aziza', phone: '+998901234567', qty: 2, type: 'Olib ketish', payment: 'Naqd', address: '', note: 'QA buyurtma' });
    await click('[data-action="accept"][data-id="1"]'); await submit({ minutes: 20 });
    await click('[data-tab="preparing"]'); await click('[data-action="ready"][data-id="1"]');
    await until("document.querySelector('#save-status').textContent==='Bazada saqlandi' && !document.body.classList.contains('saving')");
    await click('[data-tab="ready"]'); await click('[data-action="done"][data-id="1"]');
    await until("document.querySelector('#save-status').textContent==='Bazada saqlandi' && !document.body.classList.contains('saving')");
    const saved = await evaluate(`OwnerAPI.request('/businesses/${restaurant}/state')`);
    assert.equal(saved.state.orders[0].status, 'done'); assert.ok(saved.state.orders[0].completed);
    await view('overview');
    assert.equal(await evaluate('OwnerAPI.businesses[0].sales'), 76000, await evaluate("document.querySelector('.business-sales').textContent"));
    const shop = await createBusiness('Birga Store', 'shop');
    // From 'all businesses', the chooser must lead to the panel actually clicked.
    await evaluate("(()=>{const select=document.querySelector('#business-select');select.value='';return select.onchange({target:select})})()");
    await click('[data-view="staff"]'); await until("document.querySelector('#choose-business').open");
    assert.equal(await evaluate("document.querySelectorAll('#choose-business-list button').length"), 2);
    await click(`[data-business-id="${shop}"]`);
    await until("!document.querySelector('#choose-business').open && document.querySelector('[data-view=staff]').getAttribute('aria-current')==='page'");
    assert.equal(await evaluate('OwnerAPI.business.id'), shop);
    await view('menu'); assert.ok(!await evaluate("document.querySelector('#content').textContent.includes('To‘y oshi')"));
    await click('#page-action'); await submit({ name: 'Daftar', cat: 'Umumiy', price: 12000, img: '', modifiers: '' });
    // A failed API write must not update the rendered or stored data.
    await evaluate("window.realFetch=window.fetch;window.fetch=(url,options)=>options?.method==='PUT'?Promise.resolve(new Response(JSON.stringify({error:'QA server xatosi'}),{status:503,headers:{'Content-Type':'application/json'}})):window.realFetch(url,options)");
    await click('[data-action="toggle-menu"][data-id="1"]');
    await until("document.querySelector('#admin-toast').textContent==='QA server xatosi'");
    assert.equal(await evaluate("document.querySelector('.status').textContent"), 'Sotuvda');
    await evaluate('window.fetch=window.realFetch');
    assert.equal((await evaluate(`OwnerAPI.request('/businesses/${shop}/state')`)).state.menu[0].stop, false);
    // CSV import still goes through the server.
    const csvFile = path.join(artifacts, 'owner-import.csv'); await fs.writeFile(csvFile, 'nom;kategoriya;narx\nRuchka;Umumiy;4000');
    const { root: dom } = await send('DOM.getDocument');
    const { nodeId } = await send('DOM.querySelector', { nodeId: dom.nodeId, selector: '#menu-import' });
    await send('DOM.setFileInputFiles', { nodeId, files: [csvFile] });
    await until("document.querySelector('#content').textContent.includes('Ruchka')");
    await view('overview');
    const service = await createBusiness('Birga Studio', 'service');
    await view('menu'); await click('#page-action'); await submit({ name: 'Konsultatsiya', cat: 'Xizmatlar', price: 150000, img: '', modifiers: '' });
    // Wait for the new document, rather than matching the old dashboard during reload.
    await evaluate('window.qaBeforeReload=true');
    await send('Page.reload'); await until("window.qaBeforeReload===undefined && document.querySelectorAll('.business-card').length===3");
    assert.equal(await evaluate('OwnerAPI.businesses.length'), 3);
    await until(`OwnerAPI.business?.id===${JSON.stringify(service)}`, 'restore selected business');
    await view('orders');
    assert.equal(await evaluate("document.querySelector('#choose-business').open"), false);
    await evaluate(`OwnerAPI.open(${JSON.stringify(restaurant)})`);
    await view('menu'); assert.ok(await evaluate("document.querySelector('#content').textContent.includes('To‘y oshi')"));
    assert.ok(!await evaluate("document.querySelector('#content').textContent.includes('Daftar')"));
    // A slow portfolio refresh must not overwrite a later navigation click.
    await evaluate("document.querySelector('[data-view=overview]').click();document.querySelector('[data-view=orders]').click()");
    await until("document.querySelector('[data-view=orders]').getAttribute('aria-current')==='page'");
    await delay(150);
    assert.equal(await evaluate("document.querySelector('[data-view=orders]').getAttribute('aria-current')"), 'page');
    for (const name of ['orders','menu','hours','promos','finance','analytics','reviews','couriers','staff','settings','overview']) {
      await view(name); assert.ok(await evaluate("document.querySelector('#content').textContent.length>50"), name + ' renders');
    }
    for (const viewport of [{ width: 1440, height: 1050, mobile: false, name: 'owner-desktop' }, { width: 390, height: 844, mobile: true, name: 'owner-mobile' }]) {
      await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, mobile: viewport.mobile, deviceScaleFactor: 1 });
      for (const name of ['overview','orders','menu','hours','analytics','staff','settings']) {
        await view(name); assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'), name + ' overflow at ' + viewport.width);
      }
      await view('overview');
      const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await fs.writeFile(path.join(artifacts, viewport.name + '.png'), Buffer.from(capture.data, 'base64'));
    }
    // End-to-end owner dispatch -> courier invitation -> delivery -> owner completion.
    await view('hours'); await click('[data-action="branch"][data-id="1"]'); await submit({ name: 'Amir Temur', address: 'Amir Temur ko‘chasi, 24, Toshkent' });
    await view('settings'); await fill('#settings-form', { phone: '+998901111111', address: 'Amir Temur ko‘chasi, 24, Toshkent' });
    await until("!document.body.classList.contains('saving') && document.querySelector('#save-status').textContent==='Bazada saqlandi'");
    await view('orders'); await click('#page-action');
    await submit({ customer: 'Malika', phone: '+998902222222', qty: 2, type: 'Yetkazib berish', payment: 'Naqd', address: 'Yunusobod 4-mavze, 18-uy', note: 'Eshik oldida qo‘ng‘iroq qiling' });
    await click('[data-action="accept"][data-id="2"]'); await submit({ minutes: 20 });
    await click('[data-tab="preparing"]'); await click('[data-action="ready"][data-id="2"]');
    await until("!document.body.classList.contains('saving') && document.querySelector('#save-status').textContent==='Bazada saqlandi'");
    await click('[data-tab="ready"]'); await click('[data-action="dispatch"][data-id="2"]'); await submit({ fee: 18000 });
    assert.ok(await evaluate("document.querySelector('.delivery-status').textContent.includes('Kuryer kutilmoqda')"));
    await view('couriers'); await click('#page-action'); await until('!!OwnerAPI.invite?.code');
    const invite = await evaluate('OwnerAPI.invite.code');
    await send('Page.navigate', { url: base + '/courier' });
    await until("!!document.querySelector('#courier-auth') && !document.querySelector('#courier-auth').hidden");
    await click('#auth-toggle');
    await fill('#courier-auth-form', { name: 'Sardor Aliyev', phone: '+998903333333', vehicle: 'motorcycle', city: 'Toshkent', email: 'courier-qa@example.com', password: 'CourierQaPassword-2026' });
    await until("!document.querySelector('#courier-app')?.hidden");
    await click('[data-action="join"]'); await fill('#join-form', { code: 'wrong-code' });
    await until("document.querySelector('#join-error').textContent.length>0");
    await fill('#join-form', { code: invite }); await until("!document.querySelector('#join-dialog').open");
    await click('#online-button'); await until("document.querySelector('#online-button').getAttribute('aria-pressed')==='true' && document.querySelectorAll('.job-card').length===1");
    assert.ok(!await evaluate("document.querySelector('.job-card').textContent.includes('Yunusobod')"));
    await click('[data-action="accept"]'); await until("!!document.querySelector('.delivery-detail')");
    assert.ok(await evaluate("document.querySelector('.destination').textContent.includes('Yunusobod')"));
    assert.equal(await evaluate("document.querySelector('a[href=\"tel:+998902222222\"]').textContent"), '☎ Mijozga qo‘ng‘iroq');
    for (const viewport of [{ width: 1440, height: 1050, mobile: false, name: 'courier-desktop' }, { width: 390, height: 844, mobile: true, name: 'courier-mobile' }]) {
      await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, mobile: viewport.mobile, deviceScaleFactor: 1 });
      for (const tab of ['jobs','active','earnings','profile']) {
        await click(`button[data-view="${tab}"]`);
        assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'), 'courier ' + tab + ' overflows ' + viewport.width);
      }
      await click('button[data-view="active"]');
      const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await fs.writeFile(path.join(artifacts, viewport.name + '.png'), Buffer.from(capture.data, 'base64'));
    }
    await click('[data-action="pickup"]'); await until("!!document.querySelector('[data-action=deliver]')");
    await click('[data-action="deliver"]'); await fill('#action-form', {});
    await until("!document.querySelector('#action-dialog').open && document.querySelectorAll('.history-list article').length===1");
    const courierData = await evaluate("fetch('/api/courier/dashboard').then(r=>r.json())");
    assert.equal(courierData.stats.earned, 18000); assert.equal(courierData.active.length, 0);
    await click('button[data-view="profile"]'); await fill('#profile-form', { name: 'Sardor Kuryer', phone: '+998903333333', vehicle: 'car', city: 'Toshkent' });
    await until("document.querySelector('#rider-name').textContent==='Sardor Kuryer'");
    await evaluate('window.qaBeforeReload=true'); await send('Page.reload');
    await until("window.qaBeforeReload===undefined && !!document.querySelector('#courier-app') && !document.querySelector('#courier-app').hidden");
    assert.equal(await evaluate("document.querySelector('#rider-name').textContent"), 'Sardor Kuryer');
    await click('button[data-view="profile"]'); await click('[data-action="logout"]');
    await until("!!document.querySelector('#courier-auth') && !document.querySelector('#courier-auth').hidden");
    // Logging the courier out does not sign the business owner out.
    await send('Page.navigate', { url: base + '/admin.html' });
    await until("!!document.querySelector('#navigation') && document.querySelectorAll('#navigation button').length===11 && !!OwnerAPI.business");
    const deliveredOwner = await evaluate(`OwnerAPI.request('/businesses/${restaurant}/state')`);
    assert.equal(deliveredOwner.state.orders.find(o=>o.id===2).status, 'done');
    assert.equal(deliveredOwner.deliveries.find(d=>d.orderId===2).status, 'delivered');
    await click('#logout-button'); await until("!document.querySelector('#auth-screen')?.hidden");
    await fill('#auth-form', { email: 'owner-qa@example.com', password: 'OwnerQaPassword-2026' });
    await until("document.querySelectorAll('.business-card').length===3");
    assert.deepEqual(errors, []);
    console.log('Browser QA passed: owner navigation, 3 business types, isolated records, owner dispatch, courier signup/invite/claim/pickup/delivery, independent sessions, profile persistence, server-synced completion, CSV import, 11 owner sections and 4 courier sections, desktop/mobile layouts.');
  } finally { if (ws) ws.close(); browser.kill(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
