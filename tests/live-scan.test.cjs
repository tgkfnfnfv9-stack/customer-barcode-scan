const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const moduleSource=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const source=moduleSource.slice(0,moduleSource.lastIndexOf('\nrender();\ninitialize();'));
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
    set textContent(value){this._textContent=value;for(const child of this.children)child.parentNode=null;this.children.length=0;}
    addEventListener(name,fn){this.handlers[name]=fn;}
    appendChild(child){return this.insertBefore(child,null);}
    insertBefore(child,before){child.remove();const i=before?this.children.indexOf(before):this.children.length;this.children.splice(i,0,child);child.parentNode=this;return child;}
    remove(){if(this.parentNode){const a=this.parentNode.children;a.splice(a.indexOf(this),1);this.parentNode=null;}}
    replaceWith(child){if(this.parentNode){this.parentNode.insertBefore(child,this);this.remove();}}
    getBoundingClientRect(){const top=this.parentNode?this.parentNode.children.indexOf(this)*300-sandbox.window.scrollY:0;return {top,bottom:top+300};}
    setAttribute(name,value){(this.attributes??={})[name]=value;} focus(){this.focused=true;sandbox.document.activeElement=this;} scrollIntoView(){this.scrolled=true;}
    select(){} setSelectionRange(){} click(){this.handlers.click?.();}
    showModal(){this.open=true;} close(){this.open=false;}
    pause(){} play(){return Promise.resolve();}
    getContext(){return {drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(16),width:2,height:2})};}
  }
  const declaredIds=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  const get=id=>{assert.ok(declaredIds.has(id),'Existing DOM id: '+id);if(!elements.has(id)) elements.set(id,new Element()); return elements.get(id);};
  get('scanNotice').hidden=true;
  const camera=stream();
  const sandbox={
    console,URL,Date,Uint8Array,Uint8ClampedArray,TextDecoder,Blob,AbortController,
    document:{getElementById:get,createElement:()=>new Element(),body:new Element(),hidden:false,addEventListener:(n,f)=>events[n]=f},
    window:{addEventListener:(n,f)=>events[n]=f,open(url){openedUrls.push(url);return {};},scrollY:0,scrollBy:(x,y)=>{sandbox.window.scrollY+=y;}},
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
    this.api={startScanner,stopScanner,scanCameraFrame,handleFile,addScan,render,submitManual,copyText,formatPrice,publicStock,initialize,refreshHistory,
      setHistory:items=>{history=items;render();},setInit:fn=>{initLib=fn;},
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

test('reset and page exit cancel pending album results without reviving history',async()=>{
  for(const trigger of ['reset','pagehide','visibilitychange']){
    const pending=deferred(),a=app({decode:()=>pending.promise});
    const parsing=a.api.handleFile({size:10});await flush();
    assert.equal(a.get('albumBtn').disabled,true);
    if(trigger==='reset')a.get('resetAllBtn').handlers.click();
    else if(trigger==='visibilitychange'){a.sandbox.document.hidden=true;a.events.visibilitychange();}
    else a.events.pagehide();
    pending.resolve(code('P009002'));await parsing;await flush();
    assert.equal(a.api.history().length,0,trigger);
    assert.equal(a.requests.length,0,trigger);
    assert.equal(a.get('albumBtn').disabled,false,trigger);
  }
});

test('cancelled album work cannot clear a newer album session busy state',async()=>{
  const first=deferred(),second=deferred();let calls=0;
  const a=app({decode:()=>++calls===1?first.promise:second.promise});
  const old=a.api.handleFile({size:10});await flush();a.get('resetAllBtn').handlers.click();
  const next=a.api.handleFile({size:10});first.resolve(code('P009000'));await old;await flush();
  assert.equal(a.get('albumBtn').disabled,true);
  assert.equal(a.api.history().length,0);
  second.resolve(code('P009001'));await next;await flush();
  assert.equal(a.api.history()[0].code,'P009001');
  assert.equal(a.get('albumBtn').disabled,false);
});

test('copy feedback reports the snapshot count even when history resets while copying',async()=>{
  const pending=deferred(),a=app();let copied;
  a.sandbox.navigator.clipboard={writeText:text=>{copied=text;return pending.promise;}};
  a.api.setHistory([{code:'P009000'},{code:'P009001'}]);
  a.get('copyAllBtn').handlers.click();a.get('resetAllBtn').handlers.click();
  pending.resolve();await flush();
  assert.equal(copied,'P009000\nP009001');
  assert.match(a.get('status').textContent,/コピーしました（2件）/);
});

test('deleting a just-registered card clears its obsolete success notice',async()=>{
  const a=app();a.api.addScan('P009000','手入力');await flush();
  assert.equal(a.get('scanNotice').hidden,false);
  descendants(a.get('histList')).find(n=>n.className==='del').onclick();
  assert.equal(a.get('scanNotice').hidden,true);
  assert.equal(a.api.history().length,0);
});

test('broken photo requests are replaced by an explicit fallback',()=>{
  const a=app();a.api.setHistory([{code:'P009000',stock:{name:'test',head_picture_url:'/photos/missing.jpg'}}]);
  const image=descendants(a.get('histList')).find(n=>n.className==='stock-photo');assert.ok(image);
  image.onerror();
  assert.equal(descendants(a.get('histList')).some(n=>n.className==='stock-photo'),false);
  assert.ok(descendants(a.get('histList')).some(n=>/写真なし|写真を表示できません/.test(n.textContent)));
});

const response=(stock,status=200)=>({ok:status>=200&&status<300,status,json:async()=>stock});
const item=(code,stock={name:'公開機械',detail_spec:'仕様'})=>({code,stock});

test('opening a lower specification keeps its DOM, focus and scroll position',()=>{
  const a=app();a.api.setHistory(['P009000','P009001','P009002'].map(code=>item(code)));
  const rows=[...a.get('histList').children];const toggle=descendants(rows[2]).find(n=>n.className==='spec-toggle');
  a.sandbox.window.scrollY=600;toggle.focus();toggle.onclick();
  assert.deepEqual(a.get('histList').children,rows);assert.equal(a.sandbox.window.scrollY,600);
  assert.equal(a.sandbox.document.activeElement,toggle);assert.equal(toggle.attributes['aria-expanded'],'true');
  assert.equal(descendants(rows[2]).find(n=>n.className==='stock-spec').hidden,false);
  a.events.resize();assert.deepEqual(a.get('histList').children,rows);
});

test('a stock completion cannot replace unrelated cards',async()=>{
  const pending=deferred(),a=app({stockResponse:()=>pending.promise});
  const items=['P009000','P009001','P009002'].map(code=>item(code));a.api.setHistory(items);
  const third=a.get('histList').children[2];const loading=a.api.loadStock(items[0]);
  pending.resolve(response({name:'updated'}));await loading;
  assert.equal(a.get('histList').children[2],third);
});

test('history restoration normalizes codes, excludes invalid entries and deduplicates',()=>{
  const a=app({storedHistory:[null,{},item(' p009000 '),item('P009000'),item('bad'),{code:'Ｐ００９００１',fmt:{bad:true}}]});
  assert.equal(JSON.stringify(a.api.history()),JSON.stringify([{code:'P009000',fmt:''},{code:'P009001',fmt:''}]));
});

test('manual entry normalizes Japanese width and case and rejects invalid numbers',async()=>{
  const a=app();a.get('manualInput').value=' ｐ００９ ０００ ';a.api.submitManual();await flush();
  assert.equal(a.api.history()[0].code,'P009000');const count=a.requests.length;
  for(const value of ['bad','1234567','P009000/foo','']){a.get('manualInput').value=value;a.api.submitManual();}
  assert.equal(a.api.history().length,1);assert.equal(a.requests.length,count);
});

test('headers and JSON bodies both have a fifteen-second timeout',async()=>{
  for(const stage of ['headers','body']){
    const stalled=deferred();
    const a=app({stockResponse:()=>stage==='headers'?stalled.promise:Promise.resolve({ok:true,status:200,json:()=>stalled.promise})});
    a.api.addScan('P009000','手入力');await flush();
    const timer=[...a.timers.values()].find(t=>t.ms===15000);assert.ok(timer,stage);timer.fn();await flush();
    assert.equal(a.api.history()[0].stockLoading,false);assert.match(a.api.history()[0].stockError,/タイムアウト/);
    assert.ok(descendants(a.get('histList')).some(n=>n.textContent==='再取得'));
  }
});

test('a late older stock request cannot overwrite the latest response',async()=>{
  const first=deferred(),second=deferred();let calls=0;
  const a=app({stockResponse:()=>++calls===1?first.promise:second.promise});
  const entry=item('P009000');a.api.setHistory([entry]);const old=a.api.loadStock(entry),latest=a.api.loadStock(entry);
  second.resolve(response({name:'latest'}));await latest;first.resolve(response({name:'obsolete'}));await old;
  assert.equal(entry.stock.name,'latest');assert.equal(entry.stockLoading,false);
});

test('deleted or reset entries ignore late public replies',async()=>{
  for(const reset of [true,false]){
    const pending=deferred(),a=app({stockResponse:()=>pending.promise});a.api.addScan('P009000','手入力');
    if(reset)a.get('resetAllBtn').handlers.click();else descendants(a.get('histList')).find(n=>n.className==='del').onclick();
    pending.resolve(response({name:'late'}));await flush();
    assert.equal(a.api.history().length,0);assert.equal(a.get('histList').children.length,0);
  }
});

test('public response rejects arrays and safely removes unexpected field types and all private fields',()=>{
  const a=app();for(const value of [null,[],42])assert.throws(()=>a.api.publicStock(value),/形式が不正/);
  const parsed=a.api.publicStock({name:{toString:1},memo:'PRIVATE',price:100,current_price:200,public_price:{toString:1}});
  assert.equal(parsed.name,'');assert.equal(parsed.public_price,'');assert.equal(parsed.memo,undefined);assert.equal(parsed.price,undefined);
  for(const bad of ['¥','￥, ','0x10','Infinity',{},null])assert.equal(a.api.formatPrice(bad),'');
  assert.equal(a.api.formatPrice(0),'¥0');assert.equal(a.api.formatPrice('￥1,500,000'),'¥1,500,000');
});

test('initial history refresh limits simultaneous requests to three and does not delay decoder initialization',async()=>{
  const pending=[];const a=app({storedHistory:Array.from({length:8},(_,i)=>({code:'P'+String(9000+i).padStart(6,'0')})),stockResponse:()=>{const d=deferred();pending.push(d);return d.promise;}});
  let initialized=false;a.api.setInit(async()=>{initialized=true;});const startup=a.api.initialize();await flush();
  assert.equal(initialized,true);assert.equal(a.requests.length,3);
  for(let i=0;i<8;i++){await flush();assert.ok(pending[i]);pending[i].resolve(response({name:'fresh'}));}
  await startup;assert.equal(a.requests.length,8);
  assert.equal(a.api.history().every(item=>item.stock?.name==='fresh'&&!item.stockLoading),true);
  for(const request of a.requests){assert.equal(request.options.credentials,'omit');assert.equal(request.options.headers.Authorization,undefined);}
});

test('clipboard fallback removes temporary fields even on errors and restores the original focus',async()=>{
  const a=app();delete a.sandbox.navigator.clipboard;a.get('manualInput').focus();
  a.sandbox.document.execCommand=()=>{throw new Error('blocked');};
  await assert.rejects(a.api.copyText('P009000'),/blocked/);
  assert.equal(a.sandbox.document.body.children.length,0);assert.equal(a.sandbox.document.activeElement,a.get('manualInput'));
});


test('cancelled photo work leaves a ready status when returning to the page',async()=>{
  const pending=deferred(),a=app({decode:()=>pending.promise});
  const work=a.api.handleFile({size:10});await flush();
  a.sandbox.document.hidden=true;a.events.visibilitychange();
  a.sandbox.document.hidden=false;a.events.visibilitychange();
  pending.resolve(code('P009000'));await work;
  assert.equal(a.get('status').textContent,'写真解析を中止しました');
  assert.equal(a.get('led').className,'led ready');
  assert.equal(a.api.history().length,0);
});
