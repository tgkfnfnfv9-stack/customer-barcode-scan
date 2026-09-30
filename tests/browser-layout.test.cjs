const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium,webkit}=require('playwright');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const broken=html.replace(/(<script[^>]*id="zxwasm"[^>]*>)[\s\S]*?(<\/script>)/,'$1AAECAw==$2');
let server,url;
before(async()=>{
  server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(req.url.includes('bad-wasm')?broken:html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}/`;
});
after(async()=>{await new Promise(resolve=>server.close(resolve));});
const stock={name:'テスト機械',maker:'メーカー',model_type:'V33i',year_type:'2001',detail_spec:'主軸仕様\n'.repeat(12),public_price:1500000,
  price:9900000,current_price:8800000,internal_price:7700000,memo:'PRIVATE SECRET',price_memo:'PRIVATE PRICE'};
async function fixture(browser,{count=12,delayFirst=false,missingPrice=false,badWasm=false}={}){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true});
  await context.addCookies([{name:'staff-test-cookie',value:'test-only',domain:'www.kkmt.co.jp',path:'/',secure:true,sameSite:'None'}]);
  await context.addInitScript(({count})=>{
    localStorage.setItem('kkmt_customer_barcode_history',JSON.stringify(Array.from({length:count},(_,i)=>({code:'P'+String(9000+i).padStart(6,'0'),fmt:'手入力'}))));
    localStorage.setItem('kkmt_barcode_auth',JSON.stringify({token:'MUST NOT SEND',expires_at:new Date(Date.now()+60000).toISOString()}));
    localStorage.setItem('kkmt_barcode_history',JSON.stringify([{code:'P009999',stock:{memo:'STAFF CACHE SECRET'}}]));
  },{count});
  const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
  let release;
  // 全API/写真通信はfixtureで受け、実在の社員サイトには接続しない。
  await page.route('https://www.kkmt.co.jp/**',async route=>{
    const request=route.request();
    if(request.url().includes('/photos/missing.jpg'))return route.fulfill({status:404,body:''});
    requests.push(await request.allHeaders());
    if(delayFirst&&request.url().endsWith('/P009000'))await new Promise(resolve=>{release=resolve;});
    const data={...stock,public_price:missingPrice?'':stock.public_price,head_picture_url:missingPrice?'/photos/missing.jpg':''};
    await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
  });
  await page.goto(url+(badWasm?'bad-wasm/':''));
  if(badWasm)await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('初期化に失敗'));
  else await page.waitForFunction(()=>document.querySelector('#scanButtonLabel').textContent==='スキャン');
  if(delayFirst)await page.waitForFunction(()=>document.querySelectorAll('.spec-toggle').length===11);
  else await page.waitForFunction(()=>!document.querySelector('.stock-state'));
  return {context,page,errors,requests,release:()=>release()};
}
for(const [name,type] of Object.entries({chromium,webkit})){
  test(`${name}: lower specification and delayed API updates preserve reading position`,async()=>{
    const browser=await type.launch({headless:true});
    try{
      const {context,page,errors,release}=await fixture(browser,{delayFirst:true});
      const row=page.locator('.row').nth(7),toggle=row.locator('.spec-toggle');await toggle.scrollIntoViewIfNeeded();await toggle.focus();
      await row.evaluate(el=>{el.dataset.identity='preserved';});
      const box=await toggle.boundingBox(),y=await page.evaluate(()=>window.scrollY);
      await toggle.click();assert.equal(await row.getAttribute('data-identity'),'preserved');
      assert.ok(Math.abs((await toggle.boundingBox()).y-box.y)<2);assert.ok(Math.abs((await page.evaluate(()=>window.scrollY))-y)<2);
      assert.equal(await toggle.evaluate(el=>el===document.activeElement),true);assert.equal(await toggle.getAttribute('aria-expanded'),'true');
      release();await page.waitForFunction(()=>!document.querySelector('.stock-state'));
      assert.equal(await row.getAttribute('data-identity'),'preserved');assert.ok(Math.abs((await toggle.boundingBox()).y-box.y)<2);
      await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
      await page.setViewportSize({width:360,height:780});assert.equal(await row.getAttribute('data-identity'),'preserved');
      assert.deepEqual(errors,[]);await context.close();
    }finally{await browser.close();}
  });
  test(`${name}: public-only fields, missing price and failed photo stay correct`,async()=>{
    const browser=await type.launch({headless:true});
    try{
      const {context,page,errors,requests}=await fixture(browser,{count:1,missingPrice:true});
      await page.waitForFunction(()=>document.querySelector('.stock-photo-placeholder')?.textContent==='写真なし');
      const text=await page.locator('#histList').innerText();assert.match(text,/価額\s+---/);assert.doesNotMatch(text,/PRIVATE|STAFF CACHE|9,900,000|8,800,000|この機械を見る|社員ログイン/);
      assert.equal(await page.locator('.row').count(),1);
      for(const headers of requests){assert.equal(headers.authorization,undefined);assert.equal(headers.cookie,undefined);}
      const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('kkmt_customer_barcode_history')));assert.deepEqual(stored,[{code:'P009000',fmt:'手入力'}]);
      assert.deepEqual(errors,[]);await context.close();
    }finally{await browser.close();}
  });
  test(`${name}: corrupt WASM reports an error and manual registration remains usable`,async()=>{
    const browser=await type.launch({headless:true});
    try{
      const {context,page,errors}=await fixture(browser,{count:0,badWasm:true});
      assert.equal(await page.locator('#capBtn').isDisabled(),true);assert.equal(await page.locator('#albumBtn').isDisabled(),true);
      await page.locator('#manualInput').fill('p009000');await page.locator('#manualAddBtn').click();
      await page.waitForFunction(()=>document.querySelector('.public-price'));
      assert.match(await page.locator('#histList').innerText(),/P009000.*価額.*1,500,000/s);
      assert.deepEqual(errors,[]);await context.close();
    }finally{await browser.close();}
  });
}
