const test=require('node:test'),assert=require('node:assert/strict'),C=require('./dist/seller-core.js');
test('orders must follow kitchen workflow; acceptance time and rejection reason are required',()=>{
 const original=C.seed().orders.find(o=>o.status==='new');
 assert.throws(()=>C.transition(original,'done'));
 for(const minutes of [0,4,181,NaN,2.5])assert.throws(()=>C.transition(original,'preparing',{minutes}));
 assert.throws(()=>C.transition(original,'rejected',{reason:' '}));
 const rejected=C.transition(original,'rejected',{reason:' Taom qolmadi '});assert.equal(rejected.reason,'Taom qolmadi');
 const accepted=C.transition(original,'preparing',{minutes:25});assert.equal(accepted.minutes,25);assert.ok(accepted.accepted);
 const ready=C.transition(accepted,'ready'),done=C.transition(ready,'done');assert.ok(done.completed);assert.throws(()=>C.transition(done,'preparing',{minutes:20}));assert.equal(original.status,'new');
});
test('CSV and Excel row imports validate entire batch before appending',()=>{
 const categories=['Milliy taomlar'];
 const rows=C.parseCSV('\uFEFFnom;kategoriya;narx;rasm;modifikator\r\n"Osh, to‘y";Milliy taomlar;38000;;"Go‘sht +15000; Salat +8000"');
 const imported=C.importRows(rows,categories,6);assert.equal(imported.length,1);assert.equal(imported[0].name,'Osh, to‘y');assert.equal(imported[0].modifiers,'Go‘sht +15000; Salat +8000');assert.equal(imported[0].id,6);
 assert.throws(()=>C.importRows([...rows,['Taom','Milliy taomlar','-1']],categories,6));
 assert.throws(()=>C.importRows([rows[0],['Taom','Noma’lum','10']],categories,6));
 assert.throws(()=>C.parseCSV('nom,"yopilmagan'));
 assert.throws(()=>C.importRows([['name','price'],['Taom','10']],categories,6));
});
test('menu rejects unsafe image URLs and invalid prices; receipt totals use item quantities',()=>{
 const s=C.seed(),p=s.menu[0];for(const price of [0,-1,Infinity,NaN,1000000001])assert.throws(()=>C.validateMenu({...p,price},s.categories));
 assert.throws(()=>C.validateMenu({...p,img:'javascript:alert(1)'},s.categories));assert.throws(()=>C.validateMenu({...p,img:'http://example.com/a.jpg'},s.categories));
 assert.equal(C.total(s.orders[0]),88000);assert.equal(C.esc('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');
});
