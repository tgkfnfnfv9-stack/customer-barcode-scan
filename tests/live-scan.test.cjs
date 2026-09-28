const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const moduleSource=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const source=moduleSource.slice(0,moduleSource.lastIndexOf('\nrender();\nhistory.forEach('));
const flush=async()=>{for(let i=0;i<12;i++) await Promise.resolve();};
function deferred(){let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve};}
function stream(){
  const listeners={};
  const track={stopped:false,stop(){this.stopped=true;},addEventListener(name,fn){listeners[name]=fn;}};
  return {track,listeners,getTracks:()=>[track],getVideoTracks:()=>[track]};
}
function app({getUserMedia,decode,storedHistory,stockResponse}={}){
  const timers=new Map(), elements=new Map(), events={}, storage=new Map(), requests=[];
  let timerId=0, context;
  const openedUrls=[], copied=[];
  if(storedHistory) storage.set('kkmt_customer_barcode_history',JSON.stringify(storedHistory));
  class Element{
    constructor(){
      this.style={}; this.children=[]; this.childNodes=this.children; this.handlers={}; this.hidden=false; this.open=false;
      this.textContent=''; this.value=''; this.readyState=4; this.videoWidth=1280; this.videoHeight=720;
      this.classList={add(){},remove(){},toggle(){}};
    }
    get textContent(){return this._textContent;}
    set textContent(value){this._textContent=value;this.children.length=0;}
    addEventListener(name,fn){this.handlers[name]=fn;}
    appendChild(child){this.children.push(child);}
    setAttribute(){} focus(){this.focused=true;} scrollIntoView(){this.scrolled=true;}
    showModal(){this.open=true;} close(){this.open=false;}
    pause(){} play(){return Promise.resolve();}
    getContext(){return {drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(16),width:2,height:2})};}
  }
  const declaredIds=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  const get=id=>{assert.ok(declaredIds.has(id),'Existing DOM id: '+id);if(!elements.has(id)) elements.set(id,new Element()); return elements.get(id);};
  get('scanNotice').hidden=true;
  const camera=stream();
  const sandbox={
    console,URL,Date,Uint8Array,Uint8ClampedArray,TextDecoder,Blob,
    document:{getElementById:get,createElement:()=>new Element(),body:new Element(),hidden:false,addEventListener:(n,f)=>events[n]=f},
    window:{addEventListener:(n,f)=>events[n]=f,open(url){openedUrls.push(url);return {};}},
    navigator:{clipboard:{writeText:async text=>{copied.push(text);}},mediaDevices:{getUserMedia:getUserMedia||(()=>Promise.resolve(camera))}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    location:{href:'https://example.test/',origin:'https://example.test/',pathname:'/'},
    setTimeout:(fn,ms)=>{const id=++timerId; timers.set(id,{fn,ms}); return id;},clearTimeout:id=>timers.delete(id),
    fetch:async (url,options)=>{
      requests.push({url,options});
      return stockResponse?stockResponse(url,options):{ok:true,status:200,json:async()=>({
        name:'マシニングセンタ',maker:'FANUC',model_type:'テスト型番',year_type:'2018',
        detail_spec:'主軸仕様',public_price:1500000,head_picture_url:'/uploads/photo.jpg',
        price:9000000,current_price:8000000,memo:'社内限定メモ'
      })};
    },
    testDecode:decode||(()=>Promise.resolve([]))
  };
  context=vm.createContext(sandbox);
  vm.runInContext(source+`\nreadBarcodes=testDecode; updateScanButton(); render();
    this.api={startScanner,stopScanner,scanCameraFrame,handleFile,addScan,
      session:()=>cameraSession,history:()=>history,loadStock,
      setDecoder:fn=>{readBarcodes=fn;},setMedia:fn=>{navigator.mediaDevices.getUserMedia=fn;}};`,context);
  return {api:context.api,get,camera,events,storage,requests,sandbox,openedUrls,copied,
    tick:async()=>{const next=[...timers].find(([,v])=>v.ms===220); assert.ok(next,'next scan scheduled'); timers.delete(next[0]); await next[1].fn(); await flush();},
    timers};
}
const code=value=>[{text:value,format:'Code128'}];
const textTree=element=>[element.textContent,...element.children.flatMap(textTree)].join(' ');
const descendants=element=>[element,...element.children.flatMap(descendants)];

test('live decode closes camera and registers only after confirmation in another frame',async()=>{
  const a=app({decode:async()=>code('P009000')});
  await a.api.startScanner(); await flush();
  assert.equal(a.get('scanner').open,true);
  assert.equal(a.api.history().length,0);
  await a.tick();
  assert.equal(a.get('scanner').open,false);
  assert.equal(a.camera.track.stopped,true);
  assert.equal(a.get('cameraVideo').srcObject,null);
  assert.equal(a.api.history().length,1);
  assert.equal(a.api.history()[0].code,'P009000');
  assert.equal(a.api.history()[0].stock.public_price,1500000);
  assert.match(a.get('scanNotice').textContent,/登録しました/);
  assert.equal(a.get('scanNotice').scrolled,true);
  assert.equal(a.get('scanButtonLabel').textContent,'スキャン');
  assert.equal(a.requests.length,1);
  assert.equal(a.timers.size,0);
  assert.equal(JSON.parse(a.storage.get('kkmt_customer_barcode_history'))[0].code,'P009000');
});
test('invalid or empty frames keep scanning; a changed candidate requires confirmation',async()=>{
  const results=[code('1234567'),[],code('P009000'),code('P009001'),code('P009001')];
  const a=app({decode:async()=>results.shift()});
  await a.api.startScanner(); await flush();
  for(let i=0;i<3;i++){await a.tick(); assert.equal(a.api.history().length,0);}
  await a.tick(); assert.equal(a.api.history()[0].code,'P009001');
});
test('cancel while permission is pending stops a late stream without registering',async()=>{
  const permission=deferred(), late=stream();
  const a=app({getUserMedia:()=>permission.promise});
  const opening=a.api.startScanner();
  a.api.stopScanner(); permission.resolve(late); await opening;
  assert.equal(late.track.stopped,true);
  assert.equal(a.api.history().length,0);
  assert.equal(a.get('scanner').open,false);
});
test('closing during decoding ignores its result and does not stop the next session',async()=>{
  const pending=deferred(), a=app({decode:()=>pending.promise});
  await a.api.startScanner(); await flush();
  a.api.stopScanner();
  const next=stream(); a.api.setMedia(async()=>next); a.api.setDecoder(async()=>[]);
  await a.api.startScanner(); pending.resolve(code('P009000')); await flush();
  assert.equal(a.api.history().length,0);
  assert.equal(a.get('scanner').open,true);
  assert.equal(next.track.stopped,false);
  a.api.stopScanner(); assert.equal(next.track.stopped,true);
});
test('double tapping start only requests one camera',async()=>{
  let calls=0; const pending=deferred(); const a=app({getUserMedia:()=>{calls++;return pending.promise;}});
  const opening=a.api.startScanner(); await a.api.startScanner(); assert.equal(calls,1);
  pending.resolve(a.camera); await opening; a.api.stopScanner();
});
test('scanning the same code again moves it to the top without duplicate rows',async()=>{
  const a=app({decode:async()=>code('P009000')});
  a.api.addScan('P009000','Code128'); a.api.addScan('P009001','Code128'); await flush();
  await a.api.startScanner(); await flush(); await a.tick();
  assert.equal(a.api.history().length,2);
  assert.equal(a.api.history()[0].code,'P009000');
  assert.match(a.get('scanNotice').textContent,/登録済み/);
});
test('permission errors expose a usable fallback and allow retry',async()=>{
  const a=app({getUserMedia:async()=>{throw {name:'NotAllowedError'};}});
  await a.api.startScanner();
  assert.equal(a.api.session(),null); assert.equal(a.get('scanner').open,false);
  assert.match(a.get('scanNotice').textContent,/カメラ使用を許可/);
  a.api.setMedia(async()=>a.camera); await a.api.startScanner();
  assert.equal(a.get('scanner').open,true); a.api.stopScanner();
});
test('backgrounding, page exit, Escape, manual entry and interrupted track release camera',async()=>{
  for(const trigger of ['visibilitychange','pagehide','cancel','manual','ended','mute']){
    const a=app(); await a.api.startScanner(); await flush();
    if(trigger==='visibilitychange'){a.sandbox.document.hidden=true; a.events.visibilitychange();}
    else if(trigger==='pagehide') a.events.pagehide();
    else if(trigger==='cancel') a.get('scanner').handlers.cancel({preventDefault(){}});
    else if(trigger==='manual') a.get('scannerManual').handlers.click();
    else a.camera.listeners[trigger]();
    assert.equal(a.camera.track.stopped,true,trigger);
    assert.equal(a.get('scanner').open,false,trigger);
    assert.equal(a.api.history().length,0,trigger);
  }
});
test('album image decoding registers and fetches public information',async()=>{
  const a=app({decode:async()=>code('P009002')});
  a.get('albumInput').handlers.change({target:{files:[{size:10}],value:'selected'}}); await flush();
  assert.equal(a.api.history()[0].code,'P009002');
  assert.equal(a.requests.length,1); assert.equal(a.get('capBtn').disabled,false);
});
test('repeated decoder errors stop camera and show retry guidance',async()=>{
  const a=app({decode:async()=>{throw new Error('decode failed');}});
  await a.api.startScanner(); await flush(); await a.tick(); await a.tick();
  assert.equal(a.camera.track.stopped,true);
  assert.equal(a.api.history().length,0);
  assert.match(a.get('scanNotice').textContent,/もう一度スキャン/);
});

test('public stock displays photo, specification and public_price without a site button or private fields',async()=>{
  const stored=[{code:'P008493',fmt:'Code39'}];
  const a=app({storedHistory:stored});
  assert.equal(JSON.stringify(a.api.history()),JSON.stringify(stored));
  await a.api.loadStock(a.api.history()[0]); await flush();
  let row=a.get('histList').children[0];
  assert.match(textTree(row),/価額.*¥1,500,000/);
  assert.doesNotMatch(textTree(row),/社内限定メモ|¥9,000,000|¥8,000,000|この機械を見る/);
  assert.equal(descendants(row).find(node=>node.className==='stock-photo').src,'https://www.kkmt.co.jp/uploads/photo.jpg');
  assert.equal(descendants(row).find(node=>node.className==='stock-spec').hidden,true);
  descendants(row).find(node=>node.className==='spec-toggle').onclick();
  row=a.get('histList').children[0];
  assert.equal(descendants(row).find(node=>node.className==='stock-spec').hidden,false);
  assert.match(textTree(row),/主軸仕様/);
  assert.equal(a.requests[0].options.credentials,'omit');
  assert.equal(a.requests[0].options.headers.Authorization,undefined);
  assert.equal(JSON.stringify(a.api.history()[0].stock).includes('memo'),false);
  assert.equal(a.openedUrls.length,0);
});
test('no public_price shows a muted ---; stored history contains only code and format',async()=>{
  const a=app({stockResponse:async()=>({ok:true,status:200,json:async()=>({
    name:'売約済み機械',public_price:'',price:2500000,current_price:2300000,memo:'社内情報'
  })})});
  a.api.addScan('P009000','Code128'); await flush();
  const row=a.get('histList').children[0];
  assert.equal(descendants(row).some(node=>node.className==='public-price'),true);
  assert.match(textTree(row),/価額\s+---/);
  assert.equal(descendants(row).find(node=>node.className==='value missing').textContent,'---');
  assert.doesNotMatch(textTree(row),/¥2,500,000|¥2,300,000|社内情報/);
  assert.equal(a.storage.get('kkmt_customer_barcode_history'),JSON.stringify([{code:'P009000',fmt:'Code128'}]));
});
test('request errors offer retry without navigating away',async()=>{
  let failed=true;
  const a=app({stockResponse:async()=>failed?{ok:false,status:404}:{ok:true,status:200,json:async()=>({name:'機械',public_price:500000})}});
  a.api.addScan('P009000','Code128'); await flush();
  let row=a.get('histList').children[0];
  assert.match(textTree(row),/機械情報が見つかりません/);
  failed=false;
  const retry=descendants(row).find(node=>node.textContent==='再取得');
  await retry.onclick(); await flush();
  row=a.get('histList').children[0];
  assert.match(textTree(row),/¥500,000/);
  assert.equal(a.openedUrls.length,0);
});
test('manual entry, individual and all copy, deletion and reset keep their customer behavior',async()=>{
  const a=app({storedHistory:[{code:'P009000',fmt:'Code128'}]});
  a.get('manualInput').value='P009002';
  a.get('manualAddBtn').handlers.click();
  assert.equal(a.api.history()[0].fmt,'手入力');
  assert.equal(a.get('manualInput').value,'');
  const top=a.get('histList').children[0].children.find(child=>child.className==='top');
  top.children.find(child=>child.className==='copy').onclick(); await flush();
  assert.equal(a.copied[0],'P009002');
  a.get('copyAllBtn').handlers.click(); await flush();
  assert.equal(a.copied[1],'P009002\nP009000');
  top.children.find(child=>child.className==='del').onclick();
  assert.equal(a.api.history().length,1);
  assert.equal(a.api.history()[0].code,'P009000');
  a.get('resetAllBtn').handlers.click();
  assert.equal(a.api.history().length,0);
  assert.equal(a.storage.get('kkmt_customer_barcode_history'),'[]');
});
