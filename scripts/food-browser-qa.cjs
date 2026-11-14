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
    await send('Page.navigate', {url:base+'/'});
    await until("document.querySelectorAll('.restaurant').length===6");
    await click('[data-restaurant="sample-1"]');
    await until("document.querySelectorAll('.food-card').length===4");
    await click('[data-add="1"]'); await click('[data-add="1"]');
    assert.equal(await evaluate("document.querySelector('#cart-count').textContent"),'2');
    await click('#cart-button');
    assert.equal(await evaluate("document.querySelector('#checkout-form')===null"),true);
    await click('#cart-dialog [data-close]');
    await click('[data-restaurant="sample-2"]'); await click('[data-add="1"]');
    await until("document.querySelector('#info-dialog').open"); await click('#confirm-switch');
    assert.equal(await evaluate("document.querySelector('#cart-count').textContent"),'1');
    await click('#address-button'); await fill('#address-form',{address:'Toshkent, Amir Temur 12'});
    assert.equal(await evaluate("document.querySelector('#address-label').textContent"),'Toshkent, Amir Temur 12');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true}).then(r=>fs.writeFile(path.join(artifacts,'food-mobile.png'),Buffer.from(r.data,'base64')));
    await send('Emulation.setDeviceMetricsOverride',{width:1365,height:900,deviceScaleFactor:1,mobile:false});
    await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true}).then(r=>fs.writeFile(path.join(artifacts,'food-desktop.png'),Buffer.from(r.data,'base64')));
    const restaurantId=await evaluate(`(async()=>{const request=async(path,data,method='POST')=>{const r=await fetch('/api'+path,{method:data===undefined?'GET':method,headers:{'Content-Type':'application/json','X-Birga-Request':'1'},body:data===undefined?undefined:JSON.stringify(data)});const value=await r.json();if(!r.ok)throw Error(value.error);return value};await request('/auth/register',{name:'Food Owner',email:'food-qa@example.com',password:'FoodQaPassword2026'});const {business}=await request('/businesses',{name:'Kitchen QA',kind:'restaurant'});const data=await request('/businesses/'+business.id+'/state');data.state.menu=[{id:1,name:'Test Osh',cat:'Milliy taomlar',price:38000,img:'',modifiers:'',stop:false}];data.state.hours.forEach(h=>{h.open='00:00';h.close='23:59';h.off=false});await request('/businesses/'+business.id+'/state',{revision:data.business.revision,state:data.state},'PUT');return business.id})()`);
    await send('Page.reload'); await until("document.querySelectorAll('.restaurant').length===1");
    await click('[data-restaurant="'+restaurantId+'"]'); await click('[data-add="1"]');
    await until("document.querySelector('#info-dialog').open"); await click('#confirm-switch');
    await click('#cart-button'); await until("!!document.querySelector('#checkout-form')");
    await fill('#checkout-form',{customer:'Food Customer',phone:'+998901234567',address:'Toshkent, Amir Temur 12',branch:'1',note:'Piyozsiz'});
    await until("!!document.querySelector('.receipt-icon')");
    const orders=await evaluate(`fetch('/api/businesses/${restaurantId}/state').then(r=>r.json()).then(d=>d.state.orders)`);
    assert.equal(orders.length,1); assert.equal(orders[0].customer,'Food Customer'); assert.equal(orders[0].items[0].price,38000);
    assert.equal(await evaluate("document.querySelector('#cart-count').textContent"),'0');
    await click('#cart-dialog [data-close]');
    await evaluate("document.querySelector('#search').value='No such meal';document.querySelector('#search').dispatchEvent(new Event('input'))");
    assert.equal(await evaluate("document.querySelectorAll('.restaurant').length"),0);
    assert.deepEqual(errors,[]);
    console.log('Food browser QA passed: sample menu, single-restaurant cart, quantities, address, mobile layout, search, real checkout and owner order persistence.');
  } finally { if(ws)ws.close();browser.kill();await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1});