const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const moduleSource=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const source=moduleSource.slice(0,moduleSource.lastIndexOf('\nrender();\ninitialize();'));
const flush=async()=>{for(let i=0;i<40;i++) await Promise.resolve();};
function deferred(){let resolve,reject; const promise=new Promise((r,j)=>{resolve=r;reject=j;}); return {promise,resolve,reject};}
function stream({capabilities={},settings={deviceId:'rear-main',facingMode:'environment'}}={}){
  const listeners={},constraints=[];
  const track={
    stopped:false,readyState:'live',stop(){this.stopped=true;this.readyState='ended';},
    addEventListener(name,fn){listeners[name]=fn;},
    getCapabilities:()=>capabilities,getSettings:()=>settings,
    async applyConstraints(value){constraints.push(value);Object.assign(settings,...(value.advanced||[]));}
  };
  return {track,listeners,constraints,getTracks:()=>[track],getVideoTracks:()=>[track]};
}
function app({getUserMedia,decode,storedHistory,stockResponse}={}){
  const timers=new Map(), elements=new Map(), events={}, storage=new Map(), requests=[];
  let timerId=0, context;
  const canvasDraws=[],frameReads=[];
  let now=Date.now();
  class TestDate extends Date{static now(){return now;}}
  const openedUrls=[], copied=[];
  if(storedHistory) storage.set('kkmt_customer_barcode_history',JSON.stringify(storedHistory));
  class Element{
    constructor(){
      this.style={}; this.children=[]; this.childNodes=this.children; this.handlers={}; this.hidden=false; this.open=false;
      this.textContent=''; this.value=''; this.readyState=4; this.videoWidth=1280; this.videoHeight=720; this.currentTime=0;
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
    getContext(){return {
      drawImage:(...args)=>canvasDraws.push({canvas:this,args}),
      getImageData:(x,y,width,height)=>{
        frameReads.push({width,height});
        return {data:new Uint8ClampedArray([90,120,150,255,190,210,230,255]),width,height};
      }
    };}
  }
  const declaredIds=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  const get=id=>{assert.ok(declaredIds.has(id),'Existing DOM id: '+id);if(!elements.has(id)) elements.set(id,new Element()); return elements.get(id);};
  get('scanNotice').hidden=true;
  const camera=stream();
  const sandbox={
    console,URL,Date:TestDate,Uint8Array,Uint8ClampedArray,TextDecoder,Blob,AbortController,
    testAdvance:ms=>{now+=ms;},
    document:{getElementById:get,createElement:()=>new Element(),body:new Element(),hidden:false,addEventListener:(n,f)=>events[n]=f},
    window:{innerWidth:390,innerHeight:844,addEventListener:(n,f)=>events[n]=f,open(url){openedUrls.push(url);return {};},scrollY:0,scrollBy:(x,y)=>{sandbox.window.scrollY+=y;}},
    navigator:{clipboard:{writeText:async text=>{copied.push(text);}},mediaDevices:{enumerateDevices:async()=>[],getUserMedia:getUserMedia||(()=>Promise.resolve(camera))}},
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
    this.api={startScanner,stopScanner,scanCameraFrame,enhanceContrast,handleFile,addScan,render,submitManual,copyText,formatPrice,publicStock,initialize,refreshHistory,
      setHistory:items=>{history=items;render();},setInit:fn=>{initLib=fn;},
      session:()=>cameraSession,history:()=>history,loadStock,advance:ms=>{testAdvance(ms);},
      setDecoder:fn=>{readBarcodes=fn;},setMedia:fn=>{navigator.mediaDevices.getUserMedia=fn;}};`,context);
  return {api:context.api,get,camera,events,storage,requests,sandbox,openedUrls,copied,
    canvasDraws,frameReads,
    tick:async({advance=true}={})=>{if(advance)get('cameraVideo').currentTime+=.22;const next=[...timers].find(([,v])=>v.ms===220); assert.ok(next,'next scan scheduled'); timers.delete(next[0]); await next[1].fn(); await flush();},
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
    else {
      a.camera.listeners[trigger]();
      if(trigger==='mute'){
        assert.equal(a.camera.track.stopped,false,'temporary mute keeps the stream');
        const timer=[...a.timers.values()].find(value=>value.ms===3000);
        assert.ok(timer,'persistent mute timeout');timer.fn();
      }
    }
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

// Camera acquisition and frame-processing regressions shared by customer and staff scanners.
test('camera requests sensor-oriented rear video independent of viewport orientation',async()=>{
  for(const portrait of [true,false]){
    const requests=[];
    const a=app({getUserMedia:async constraints=>{requests.push(constraints);return a.camera;}});
    a.sandbox.window.innerWidth=portrait?390:844;
    a.sandbox.window.innerHeight=portrait?844:390;
    await a.api.startScanner();await flush();
    const request=requests[0];
    assert.equal(request.audio,false);
    assert.equal(request.video.facingMode.ideal,'environment');
    assert.equal(request.video.width.ideal,1920);
    assert.equal(request.video.height.ideal,1080);
    assert.equal(request.video.frameRate.ideal,30);
    a.api.stopScanner();
  }
});

test('unsupported acquisition constraints retry once with basic rear-camera settings',async()=>{
  const requests=[];
  const a=app({getUserMedia:async constraints=>{
    requests.push(constraints);
    if(requests.length===1)throw Object.assign(new Error('unsupported resolution'),{name:'OverconstrainedError'});
    return a.camera;
  }});
  await a.api.startScanner();await flush();
  assert.equal(requests.length,2);
  assert.equal(requests[1].audio,false);
  assert.equal(requests[1].video.facingMode.ideal,'environment');
  for(const key of ['width','height','frameRate'])assert.equal(requests[1].video[key],undefined,key);
  assert.equal(a.get('scanner').open,true);
  assert.ok(a.frameReads.length>0,'basic camera fallback still scans');
  a.api.stopScanner();
});

test('permission and camera-busy errors do not repeat the camera request',async()=>{
  for(const name of ['NotAllowedError','SecurityError','NotReadableError']){
    let requests=0;
    const a=app({getUserMedia:async()=>{requests++;throw Object.assign(new Error(name),{name});}});
    await a.api.startScanner();await flush();
    assert.equal(requests,1,name);
    assert.equal(a.api.session(),null,name);
    assert.equal(a.get('scanner').open,false,name);
  }
});

test('closing during acquisition failure suppresses an obsolete fallback request',async()=>{
  const pending=deferred();let requests=0;
  const a=app({getUserMedia:()=>{requests++;return pending.promise;}});
  const opening=a.api.startScanner();
  a.api.stopScanner();
  pending.reject(Object.assign(new Error('unsupported resolution'),{name:'OverconstrainedError'}));
  await opening;await flush();
  assert.equal(requests,1);
  assert.equal(a.api.session(),null);
  assert.equal(a.get('scanner').open,false);
});

test('continuous focus and exposure are independent optional improvements',async()=>{
  const a=app(),calls=[];
  a.camera.track.getCapabilities=()=>({focusMode:['manual','continuous'],exposureMode:['continuous']});
  a.camera.track.applyConstraints=async value=>{
    calls.push(value);
    if(value.advanced?.some(option=>option.focusMode))throw new Error('focus unsupported by driver');
  };
  await a.api.startScanner();await flush();
  assert.ok(calls.some(value=>value.advanced?.some(option=>option.focusMode==='continuous')));
  assert.ok(calls.some(value=>value.advanced?.some(option=>option.exposureMode==='continuous')));
  assert.ok(calls.every(value=>!value.advanced?.some(option=>option.focusMode&&option.exposureMode)),'one failure cannot discard both modes');
  assert.equal(a.get('scanner').open,true);
  assert.ok(a.frameReads.length>0);
  a.api.stopScanner();
});

test('missing or failing capability and constraint APIs leave basic scanning usable',async()=>{
  for(const failing of ['capabilities','constraints','missing methods']){
    const a=app({decode:async()=>code('P009000')});
    if(failing==='capabilities')a.camera.track.getCapabilities=()=>{throw new Error('driver capabilities unavailable');};
    if(failing==='constraints'){
      a.camera.track.getCapabilities=()=>({focusMode:['continuous'],exposureMode:['continuous']});
      a.camera.track.getConstraints=()=>{throw new Error('driver constraints unavailable');};
    }
    if(failing==='missing methods'){
      delete a.camera.track.getCapabilities;delete a.camera.track.getConstraints;delete a.camera.track.applyConstraints;
    }
    await a.api.startScanner();await flush();
    assert.equal(a.get('scanner').open,true,failing);
    await a.tick();
    assert.equal(a.api.history()[0]?.code,'P009000',failing);
  }
});

test('ending the track during pending focus setup cannot restart its scanner',async()=>{
  const pending=deferred(),a=app();
  a.camera.track.getCapabilities=()=>({focusMode:['continuous'],exposureMode:['continuous']});
  a.camera.track.applyConstraints=()=>pending.promise;
  const opening=a.api.startScanner();await flush();
  assert.equal(a.get('scanner').open,true);
  assert.ok(a.frameReads.length>0,'optional focus setup cannot block basic decoding');
  a.camera.listeners.ended();
  const frameCount=a.frameReads.length;
  pending.resolve();await opening;await flush();
  assert.equal(a.camera.track.stopped,true);
  assert.equal(a.api.session(),null);
  assert.equal(a.get('scanner').open,false);
  assert.equal(a.frameReads.length,frameCount);
  assert.equal(a.timers.size,0);
});

test('brief track mute recovers without stopping and clears its obsolete timeout',async()=>{
  const a=app();await a.api.startScanner();await flush();
  a.camera.listeners.mute();
  const muteTimer=[...a.timers].find(([,timer])=>timer.ms===3000);
  assert.ok(muteTimer);
  assert.equal(a.camera.track.stopped,false);
  a.camera.listeners.unmute();
  assert.equal(a.timers.has(muteTimer[0]),false);
  assert.equal(a.get('scanner').open,true);
  await a.tick();
  assert.equal(a.camera.track.stopped,false);
  a.api.stopScanner();
});

test('a frozen video frame cannot confirm the same barcode twice',async()=>{
  let decoded=0;
  const a=app({decode:async()=>{decoded++;return code('P009000');}});
  await a.api.startScanner();await flush();
  for(let i=0;i<3;i++)await a.tick({advance:false});
  assert.equal(decoded,1);
  assert.equal(a.api.history().length,0);
  assert.equal(a.get('scanner').open,true);
  await a.tick();
  assert.equal(decoded,2);
  assert.equal(a.api.history()[0]?.code,'P009000');
});

test('slow phones can confirm a matching new frame after three seconds',async()=>{
  const a=app({decode:async()=>code('P009000')});
  await a.api.startScanner();await flush();
  a.api.advance(3200);await a.tick();
  assert.equal(a.api.history()[0]?.code,'P009000');
});

test('expired candidates still require a second fresh matching frame',async()=>{
  const a=app({decode:async()=>code('P009000')});
  await a.api.startScanner();await flush();
  a.api.advance(6000);await a.tick();
  assert.equal(a.api.history().length,0);
  await a.tick();assert.equal(a.api.history()[0]?.code,'P009000');
});

test('native central strips and full frames retain original and normalized passes within the pixel budget',async()=>{
  for(const [width,height] of [[3840,2160],[2160,3840],[7680,4320]]){
    const decoded=[];
    const a=app({decode:async(frame,options)=>{decoded.push({width:frame.width,height:frame.height,pixel:[...frame.data.slice(0,3)],options});return [];}});
    a.get('cameraVideo').videoWidth=width;a.get('cameraVideo').videoHeight=height;
    await a.api.startScanner();await flush();
    for(let i=0;i<3;i++)await a.tick();
    assert.equal(decoded.length,4);
    for(let index=0;index<4;index++){
      const draw=a.canvasDraws[index].args,frame=decoded[index];
      const [,sx,sy,sw,sh,,,cw,ch]=draw;
      assert.ok(frame.width*frame.height<=1200000,'each pass respects the memory and CPU budget');
      assert.equal(frame.options.tryDownscale,false,'preserved barcode detail is not downscaled inside the reader');
      if(index<2){
        assert.equal(cw,sw,'central strip keeps original horizontal pixels');
        assert.equal(ch,sh,'central strip keeps original vertical pixels');
        assert.ok(Math.abs(sx+sw/2-width/2)<=1,'strip is horizontally centered');
        assert.ok(Math.abs(sy+sh/2-height/2)<=1,'strip is vertically centered');
        assert.ok(sw<=3840);assert.ok(sh<height);
      }else{
        assert.equal(sx,0);assert.equal(sy,0);
        assert.equal(sw,width);assert.equal(sh,height,'full-frame pass covers labels outside the center');
        assert.ok(Math.max(cw,ch)<=1920);
      }
    }
    assert.deepEqual(decoded[0].pixel,[90,120,150]);
    assert.notDeepEqual(decoded[1].pixel,decoded[0].pixel);
    assert.deepEqual(decoded[2].pixel,decoded[0].pixel,'full frame retains an unmodified decode attempt');
    assert.deepEqual(decoded[3].pixel,decoded[1].pixel);
    assert.ok(decoded[0].width>1920,'high-resolution narrow bars are preserved');
    a.api.stopScanner();
  }
});

test('the visible guide stays inside the native decoded strip in portrait and landscape views',async()=>{
  for(const [width,height,vw,vh] of [[3840,2160,390,560],[2160,3840,390,560],[7680,4320,800,350]]){
    const a=app(),view=a.get('cameraView');
    Object.defineProperties(view,{clientWidth:{value:vw},clientHeight:{value:vh}});
    a.get('cameraVideo').videoWidth=width;a.get('cameraVideo').videoHeight=height;
    await a.api.startScanner();await flush();
    const [,sx,sy,sw,sh]=a.canvasDraws[0].args;
    const scale=Math.min(vw/width,vh/height);
    const cropLeft=(vw-width*scale)/2+sx*scale,cropTop=(vh-height*scale)/2+sy*scale;
    const guide=a.get('cameraGuide').style;
    const left=parseFloat(guide.left),top=parseFloat(guide.top),gw=parseFloat(guide.width),gh=parseFloat(guide.height);
    assert.ok(gw>0&&gh>0,'guide has a visible area');
    assert.ok(left>=cropLeft&&top>=cropTop,'guide begins inside decoded pixels');
    assert.ok(left+gw<=cropLeft+sw*scale&&top+gh<=cropTop+sh*scale,'guide stays inside decoded pixels');
    assert.ok(Math.abs(left+gw/2-(cropLeft+sw*scale/2))<.01);
    assert.ok(Math.abs(top+gh/2-(cropTop+sh*scale/2))<.01);
    a.api.stopScanner();
  }
});

test('video frame callbacks prevent duplicate-frame confirmation and are cancelled on stop',async()=>{
  const callbacks=new Map();let id=0,decoded=0;
  const a=app({decode:async()=>{decoded++;return code('P009000');}}),video=a.get('cameraVideo');
  video.requestVideoFrameCallback=fn=>{callbacks.set(++id,fn);return id;};
  video.cancelVideoFrameCallback=key=>callbacks.delete(key);
  const present=()=>{
    const next=[...callbacks][0];assert.ok(next);callbacks.delete(next[0]);next[1](0,{presentedFrames:id});
  };
  await a.api.startScanner();await flush();
  assert.equal(decoded,0,'wait for the first presented frame');
  present();await a.tick();assert.equal(decoded,1);
  await a.tick();assert.equal(decoded,1,'changing video time alone does not mean a new presented frame');
  assert.equal(a.api.history().length,0);
  const obsolete=[...callbacks.values()][0];
  present();await a.tick();
  assert.equal(a.api.history()[0]?.code,'P009000');
  assert.equal(callbacks.size,0);
  obsolete();assert.equal(callbacks.size,0,'late callbacks cannot resubscribe after stopping');
});


test('automatic scanning exposes no camera controls and never changes zoom, light or camera selection',async()=>{
  for(const id of ['cameraControls','cameraZoomControl','cameraZoom','cameraZoomLabel','cameraTorch','switchCamera']){
    assert.ok(!new RegExp('\\bid="'+id+'"').test(html),'removed camera control: '+id);
  }
  const requests=[];let enumerations=0;
  const a=app({getUserMedia:async value=>{requests.push(value);return a.camera;},decode:async()=>code('P009000')});
  a.camera.track.getCapabilities=()=>({focusMode:['continuous'],exposureMode:['continuous'],zoom:{min:1,max:8,step:.1},torch:true});
  a.sandbox.navigator.mediaDevices.enumerateDevices=async()=>{enumerations++;return [{kind:'videoinput',deviceId:'rear-other'}];};
  await a.api.startScanner();await flush();await a.tick();
  assert.equal(a.api.history()[0]?.code,'P009000','automatic recognition needs no camera controls');
  assert.equal(enumerations,0);
  assert.equal(requests.length,1);
  assert.equal(requests[0].video.deviceId,undefined);
  assert.equal(requests[0].video.facingMode.ideal,'environment');
  for(const applied of a.camera.constraints){
    for(const value of [applied,...(applied.advanced||[])]){
      for(const key of ['zoom','torch','deviceId'])assert.equal(value[key],undefined,key+' must not be changed');
    }
  }
});

test('automatic camera setup leaves manual-only focus and exposure modes untouched',async()=>{
  const a=app();
  a.camera.track.getCapabilities=()=>({focusMode:['manual'],exposureMode:['manual'],focusDistance:{min:0,max:100},zoom:{min:1,max:8},torch:true});
  await a.api.startScanner();await flush();
  assert.equal(a.camera.constraints.length,0,'unsupported continuous modes do not force manual camera settings');
  assert.ok(a.frameReads.length>0);
  assert.equal(a.get('scanner').open,true);
  a.api.stopScanner();
});

test('continuous autofocus remains preferred when one-shot focus is also available',async()=>{
  const a=app();
  a.camera.track.getCapabilities=()=>({focusMode:['manual','single-shot','continuous'],exposureMode:['continuous']});
  a.sandbox.navigator.mediaDevices.getSupportedConstraints=()=>({pointsOfInterest:true});
  await a.api.startScanner();await flush();
  const added=a.camera.constraints.map(value=>value.advanced.at(-1));
  assert.equal(added[0].focusMode,'continuous');
  assert.equal(added.some(value=>value.focusMode==='single-shot'),false,'working continuous autofocus is never replaced by a one-shot sweep');
  assert.deepEqual(JSON.parse(JSON.stringify(added.find(value=>value.pointsOfInterest).pointsOfInterest)),[{x:.5,y:.5}]);
  assert.equal(a.camera.track.getSettings().focusMode,'continuous');
  assert.equal(a.camera.track.getSettings().exposureMode,'continuous');
  a.api.stopScanner();
});

test('supported one-shot autofocus runs once after exposure and center setup when continuous focus is unavailable',async()=>{
  for(const unavailable of ['unsupported','rejected']){
    const a=app(),calls=[];
    a.camera.track.getCapabilities=()=>({focusMode:unavailable==='unsupported'?['manual','single-shot']:['manual','continuous','single-shot'],exposureMode:['continuous']});
    a.sandbox.navigator.mediaDevices.getSupportedConstraints=()=>({pointsOfInterest:true});
    const apply=a.camera.track.applyConstraints;
    a.camera.track.applyConstraints=async value=>{
      calls.push(value);
      if(unavailable==='rejected'&&value.advanced.at(-1).focusMode==='continuous')throw new Error('driver rejected continuous autofocus');
      await apply(value);
    };
    await a.api.startScanner();await flush();
    const added=calls.map(value=>value.advanced.at(-1));
    const expected=unavailable==='unsupported'?['exposureMode','pointsOfInterest','focusMode']:['focusMode','exposureMode','pointsOfInterest','focusMode'];
    assert.deepEqual(added.map(value=>Object.keys(value)[0]),expected,unavailable);
    assert.equal(added.at(-1).focusMode,'single-shot',unavailable+' focuses only after the target and exposure have been selected');
    assert.equal(calls.filter(value=>value.advanced.some(option=>option.focusMode==='single-shot')).length,1,unavailable+' does not retrigger a single sweep through later constraints');
    const final=Object.assign({},...calls.at(-1).advanced);
    assert.equal(final.focusMode,'single-shot',unavailable);
    assert.equal(final.exposureMode,'continuous',unavailable);
    assert.deepEqual(JSON.parse(JSON.stringify(final.pointsOfInterest)),[{x:.5,y:.5}],unavailable);
    for(const value of calls){
      assert.equal(value.width?.ideal,1920,unavailable+' preserves the requested capture width');
      assert.equal(value.height?.ideal,1080,unavailable+' preserves the requested capture height');
    }
    const count=calls.length;
    await a.tick();await a.tick();
    assert.equal(calls.length,count,unavailable+' does not hunt focus on every frame');
    assert.equal(a.get('scanner').open,true);
    a.api.stopScanner();
  }
});

test('incomplete or stale autofocus settings reports do not replace an accepted continuous focus request',async()=>{
  for(const unavailable of ['missing','throws','no focusMode','stale manual mode']){
    const a=app();
    a.camera.track.getCapabilities=()=>({focusMode:['continuous','single-shot'],exposureMode:['continuous']});
    if(unavailable==='missing')delete a.camera.track.getSettings;
    if(unavailable==='throws')a.camera.track.getSettings=()=>{throw new Error('settings unavailable');};
    if(unavailable==='no focusMode')a.camera.track.getSettings=()=>({facingMode:'environment'});
    if(unavailable==='stale manual mode')a.camera.track.getSettings=()=>({facingMode:'environment',focusMode:'manual'});
    await a.api.startScanner();await flush();
    assert.equal(a.camera.constraints[0].advanced.at(-1).focusMode,'continuous',unavailable);
    assert.equal(a.camera.constraints.some(value=>value.advanced.some(option=>option.focusMode==='single-shot')),false,unavailable+' is not evidence of rejected autofocus');
    assert.equal(a.get('scanner').open,true,unavailable);
    assert.ok(a.frameReads.length>0,unavailable);
    a.api.stopScanner();
  }
});

test('center focus is skipped unless the browser explicitly advertises points of interest',async()=>{
  for(const support of ['missing','false','absent','throws','truthy']){
    const a=app();
    a.camera.track.getCapabilities=()=>({focusMode:['continuous'],exposureMode:['continuous']});
    if(support!=='missing')a.sandbox.navigator.mediaDevices.getSupportedConstraints=()=>{
      if(support==='throws')throw new Error('constraint support unavailable');
      return support==='absent'?{}:{pointsOfInterest:support==='truthy'?1:false};
    };
    await a.api.startScanner();await flush();
    assert.equal(a.camera.constraints.length,2,support+' preserves ordinary focus and exposure setup');
    assert.equal(a.camera.constraints.some(value=>value.advanced.some(option=>option.pointsOfInterest)),false,support);
    assert.ok(a.frameReads.length>0,support);
    a.api.stopScanner();
  }
});

test('center focus is skipped when neither automatic focus mode is usable',async()=>{
  for(const focus of ['manual only','unknown capabilities','continuous rejected']){
    const a=app(),calls=[];
    a.camera.track.getCapabilities=()=>({focusMode:focus==='manual only'?['manual']:focus==='continuous rejected'?['continuous']:undefined,exposureMode:['continuous']});
    a.sandbox.navigator.mediaDevices.getSupportedConstraints=()=>({pointsOfInterest:true});
    const apply=a.camera.track.applyConstraints;
    a.camera.track.applyConstraints=async value=>{
      calls.push(value);
      if(value.advanced.at(-1).focusMode)throw new Error('autofocus unavailable');
      await apply(value);
    };
    await a.api.startScanner();await flush();
    assert.equal(calls.some(value=>value.advanced.some(option=>option.pointsOfInterest)),false,focus);
    assert.equal(a.camera.track.getSettings().exposureMode,'continuous',focus+' does not suppress exposure');
    assert.ok(a.frameReads.length>0,focus);
    a.api.stopScanner();
  }
});

test('rejected center focus cannot discard autofocus, exposure or barcode recognition',async()=>{
  for(const focusMode of ['continuous','single-shot']){
    const a=app({decode:async()=>code('P009000')}),calls=[];
    a.camera.track.getCapabilities=()=>({focusMode:[focusMode],exposureMode:['continuous']});
    a.sandbox.navigator.mediaDevices.getSupportedConstraints=()=>({pointsOfInterest:true});
    const apply=a.camera.track.applyConstraints;
    a.camera.track.applyConstraints=async value=>{
      calls.push(value);
      if(value.advanced.at(-1).pointsOfInterest)throw new Error('driver rejected focus point');
      await apply(value);
    };
    await a.api.startScanner();await flush();
    assert.equal(calls.filter(value=>value.advanced.at(-1).pointsOfInterest).length,1,focusMode);
    assert.equal(a.camera.track.getSettings().focusMode,focusMode);
    assert.equal(a.camera.track.getSettings().exposureMode,'continuous',focusMode);
    assert.equal(a.camera.track.getSettings().pointsOfInterest,undefined,focusMode+' does not reapply rejected focus points');
    if(focusMode==='single-shot')assert.equal(calls.at(-1).advanced.at(-1).focusMode,'single-shot','the one-shot sweep is still attempted after rejected points');
    await a.tick();
    assert.equal(a.api.history()[0]?.code,'P009000',focusMode);
  }
});

test('a late center focus completion cannot trigger a one-shot sweep on an obsolete session',async()=>{
  const pending=deferred(),a=app(),calls=[];
  a.camera.track.getCapabilities=()=>({focusMode:['single-shot'],exposureMode:['continuous']});
  a.sandbox.navigator.mediaDevices.getSupportedConstraints=()=>({pointsOfInterest:true});
  const apply=a.camera.track.applyConstraints;
  a.camera.track.applyConstraints=async value=>{
    calls.push(value);
    if(value.advanced.at(-1).pointsOfInterest)await pending.promise;
    await apply(value);
  };
  await a.api.startScanner();await flush();
  assert.ok(calls.some(value=>value.advanced.at(-1).pointsOfInterest),'center setup is pending');
  assert.ok(a.frameReads.length>0,'optional center setup does not block barcode decoding');
  a.api.stopScanner();
  const next=stream();a.api.setMedia(async()=>next);
  await a.api.startScanner();await flush();
  const current=a.api.session();
  pending.resolve();await flush();
  assert.equal(calls.some(value=>value.advanced.some(option=>option.focusMode==='single-shot')),false,'stopped camera never receives a late focus trigger');
  assert.equal(a.api.session(),current);
  assert.equal(next.track.stopped,false);
  assert.equal(next.constraints.length,0,'obsolete setup does not alter a newer camera');
  assert.equal(a.get('scanner').open,true);
  a.api.stopScanner();
});

test('late automatic focus completion cannot configure or disturb a newer camera session',async()=>{
  const pending=deferred(),a=app(),oldCalls=[];
  const capabilities={focusMode:['continuous'],exposureMode:['continuous']};
  a.camera.track.getCapabilities=()=>capabilities;
  a.camera.track.applyConstraints=value=>{oldCalls.push(value);return pending.promise;};
  await a.api.startScanner();await flush();
  a.api.stopScanner();
  const next=stream({capabilities});a.api.setMedia(async()=>next);
  await a.api.startScanner();await flush();
  const nextSession=a.api.session(),newCalls=next.constraints.length;
  pending.resolve();await flush();
  assert.equal(oldCalls.length,1,'obsolete setup never proceeds from focus to exposure');
  assert.equal(next.constraints.length,newCalls);
  assert.equal(a.api.session(),nextSession);
  assert.equal(next.track.stopped,false);
  assert.equal(a.get('scanner').open,true);
  a.api.stopScanner();
});

test('automatic focus and exposure preserve capture quality despite incomplete constraint reports',async()=>{
  for(const reported of ['missing method','complete','advanced only']){
    const a=app();
    a.camera.track.getCapabilities=()=>({focusMode:['continuous'],exposureMode:['continuous']});
    if(reported!=='missing method')a.camera.track.getConstraints=()=>{
      const applied=a.camera.constraints.at(-1);
      if(applied)return reported==='advanced only'?{advanced:applied.advanced}:applied;
      return {facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30}};
    };
    await a.api.startScanner();await flush();
    assert.equal(a.camera.constraints.length,2,reported);
    for(const applied of a.camera.constraints){
      assert.equal(applied.width?.ideal,1920,reported+' capture width');
      assert.equal(applied.height?.ideal,1080,reported+' capture height');
      assert.equal(applied.frameRate?.ideal,30,reported+' capture frame rate');
    }
    const values=Object.assign({},...a.camera.constraints.at(-1).advanced);
    assert.equal(values.focusMode,'continuous',reported);
    assert.equal(values.exposureMode,'continuous',reported);
    a.api.stopScanner();
  }
});

test('automatic focus does not restore acquisition constraints rejected during camera fallback',async()=>{
  let requests=0;
  const a=app({getUserMedia:async()=>{
    if(++requests===1)throw Object.assign(new Error('resolution unsupported'),{name:'OverconstrainedError'});
    return a.camera;
  }});
  a.camera.track.getCapabilities=()=>({focusMode:['continuous'],exposureMode:['continuous']});
  await a.api.startScanner();await flush();
  assert.equal(requests,2);
  assert.equal(a.camera.constraints.length,2);
  for(const applied of a.camera.constraints){
    for(const key of ['width','height','frameRate'])assert.equal(applied[key],undefined,'rejected '+key+' is not reapplied');
    assert.equal(applied.facingMode.ideal,'environment');
  }
  assert.ok(a.frameReads.length>0);
  a.api.stopScanner();
});

test('automatic contrast keeps bright and dark barcode bars distinct and expands low contrast',()=>{
  const a=app();
  for(const [dark,light] of [[130,140],[210,235],[20,40]]){
    const data=new Uint8ClampedArray(400);
    for(let pixel=0;pixel<100;pixel++){
      const gray=pixel<50?dark:light;
      data.set([gray,gray,gray,255],pixel*4);
    }
    const enhanced=a.api.enhanceContrast({data,width:100,height:1});
    const darkResult=enhanced.data[0],lightResult=enhanced.data[50*4];
    assert.ok(lightResult>darkResult,`${dark}/${light}: enhancement retains distinct bars and background`);
    assert.ok(lightResult-darkResult>light-dark,`${dark}/${light}: contrast improves without clipping both tones together`);
    for(let pixel=0;pixel<100;pixel++)assert.equal(enhanced.data[pixel*4+3],255,'alpha retained');
  }
});

test('automatic contrast does not amplify a flat frame or low-level sensor noise',()=>{
  const a=app();
  for(const range of [0,6]){
    const data=new Uint8ClampedArray(400);
    for(let pixel=0;pixel<100;pixel++){
      const gray=127+(range?pixel%(range+1):0);
      data.set([gray,gray,gray,255],pixel*4);
    }
    const original=[...data];
    const enhanced=a.api.enhanceContrast({data,width:100,height:1});
    assert.deepEqual([...enhanced.data],original,'flat or noisy frames remain unchanged');
  }
});
