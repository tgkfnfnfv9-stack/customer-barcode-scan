const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');

const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
// Observe the actual embedded WASM reader without substituting its results.
const instrumented=html.replace('readBarcodes=mod.readBarcodes;',`readBarcodes=async (input,options)=>{
  const results=await mod.readBarcodes(input,options);
  window.__decodes.push({width:input.width,height:input.height,texts:results.map(result=>result.text)});
  if(window.__cameraTest.holdDecodeAt===window.__decodes.length) await new Promise(resolve=>{window.__cameraTest.releaseDecode=resolve;});
  return results;
};`);
let server,url,browser;
before(async()=>{
  assert.notEqual(instrumented,html,'instrumentation observes the real reader');
  server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(instrumented);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  url=`http://127.0.0.1:${server.address().port}/`;
  browser=await chromium.launch({headless:true});
});
after(async()=>{
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
});

async function fixture(t,options={}){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true});
  t.after(()=>context.close());
  await context.addInitScript(options=>{
    window.__decodes=[];
    const state=window.__cameraTest={streams:[],requests:[],constraints:[],holdDecodeAt:options.holdDecodeAt};
    // Test-only Code 39 generator: nine alternating bars/spaces, 3:1 wide:narrow.
    const patterns={'*':0x094,P:0x052,0:0x034,9:0x064,1:0x121,2:0x061};
    function draw(canvas,frame){
      const ctx=canvas.getContext('2d');
      ctx.fillStyle=options.lowContrast?'rgb(162,162,162)':'white';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      if(!options.blank){
        const narrow=options.narrow||3,code='*P009000*';
        const barWidth=(code.length*16-1)*narrow;
        let x=Math.floor((canvas.width-barWidth)/2);
        const height=options.edge?Math.max(70,Math.floor(canvas.height*.08)):140;
        const y=options.edge?Math.floor(canvas.height*.04):Math.floor((canvas.height-height)/2);
        ctx.fillStyle=options.lowContrast?'rgb(112,112,112)':'black';
        for(const char of code){
          for(let i=0;i<9;i++){
            const width=narrow*((patterns[char]&(1<<(8-i)))?3:1);
            if(i%2===0)ctx.fillRect(x,y,width,height);
            x+=width;
          }
          x+=narrow;
        }
      }
      // Ensure every requested frame has a distinct image/timestamp.
      ctx.fillStyle=frame%2?'#e1e1e1':'#eeeeee';ctx.fillRect(0,0,2,2);
    }
    navigator.mediaDevices.enumerateDevices=async()=>[
      {kind:'videoinput',deviceId:'rear-main',label:'Back Camera'},
      {kind:'videoinput',deviceId:'rear-tele',label:'Back Telephoto Camera'},
      {kind:'videoinput',deviceId:'front',label:'Front Camera'},
    ];
    navigator.mediaDevices.getUserMedia=async constraints=>{
      state.requests.push(constraints);
      const canvas=document.createElement('canvas');
      canvas.width=options.width||1920;canvas.height=options.height||1080;draw(canvas,0);
      const stream=canvas.captureStream(0),track=stream.getVideoTracks()[0];
      const selected=constraints.video.deviceId;
      const deviceId=typeof selected==='string'?selected:selected?.exact||'rear-main';
      const settings={deviceId,width:canvas.width,height:canvas.height,facingMode:'environment',zoom:1,torch:false};
      Object.defineProperty(track,'label',{value:deviceId==='rear-main'?'Back Camera':'Back Telephoto Camera'});
      track.getSettings=()=>({...settings});
      track.getCapabilities=()=>options.unsupported?{}:{
        focusMode:['manual','single-shot','continuous'],exposureMode:['continuous'],whiteBalanceMode:['continuous'],
        zoom:{min:1,max:4,step:.1},torch:true,
      };
      track.applyConstraints=async value=>{
        state.constraints.push({deviceId,value});
        if(options.rejectConstraints)throw new DOMException('Optional control unsupported','OverconstrainedError');
        Object.assign(settings,value,...value.advanced||[]);
      };
      const entry={stream,track,canvas,frame:0,timer:null};state.streams.push(entry);
      entry.push=()=>{draw(canvas,++entry.frame);track.requestFrame();};
      entry.stop=()=>{clearInterval(entry.timer);entry.timer=null;};
      if(!options.manualFrames)entry.timer=setInterval(entry.push,80);
      track.addEventListener('ended',entry.stop);
      return stream;
    };
    state.push=()=>state.streams.at(-1)?.push();
    state.pause=()=>state.streams.forEach(entry=>entry.stop());
    localStorage.setItem('kkmt_barcode_auth',JSON.stringify({token:'test-only',expires_at:new Date(Date.now()+60000).toISOString()}));
  },options);
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  // Never contact a real machine-data or employee-authentication endpoint.
  await page.route('https://www.kkmt.co.jp/**',route=>route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({name:'Camera test machine',public_price:1000,current_price:1000})}));
  await page.goto(url);
  await page.waitForFunction(()=>document.querySelector('#scanButtonLabel').textContent==='スキャン');
  t.after(()=>assert.deepEqual(errors,[],'no uncaught browser errors'));
  return page;
}
async function start(page){
  await page.locator('#capBtn').click();
  await page.waitForFunction(()=>document.querySelector('#cameraVideo').readyState>=2);
}
async function waitForRegistration(page){
  await page.waitForFunction(()=>!document.querySelector('#scanner').open&&document.querySelectorAll('#histList .row').length===1,null,{timeout:10000});
  assert.match(await page.locator('#histList').innerText(),/P009000/);
  assert.equal(await page.evaluate(()=>window.__cameraTest.streams.every(entry=>entry.track.readyState==='ended')),true);
  assert.equal(await page.locator('#cameraVideo').evaluate(video=>video.srcObject),null);
}

test('real WASM reads a low-contrast barcode outside the central crop in landscape and portrait',async t=>{
  for(const [width,height] of [[1920,1080],[1080,1920]]){
    const page=await fixture(t,{width,height,edge:true,lowContrast:true});
    await start(page);await waitForRegistration(page);
    const frames=await page.evaluate(()=>window.__decodes);
    assert.ok(frames.some(frame=>frame.texts.includes('P009000')),'real barcode decoded');
    assert.ok(frames.some(frame=>Math.abs(frame.width/frame.height-width/height)<.01&&frame.texts.includes('P009000')),'full-frame fallback reads a barcode outside the crop');
    assert.ok(frames.every(frame=>Math.max(frame.width,frame.height)<=2560&&frame.width*frame.height<=2100000),'decode frames have a bounded pixel budget');
  }
});

test('one frozen camera frame cannot confirm a barcode twice',async t=>{
  const page=await fixture(t,{manualFrames:true});
  await start(page);
  await page.evaluate(()=>window.__cameraTest.push());
  await page.waitForFunction(()=>window.__decodes.some(frame=>frame.texts.includes('P009000')));
  await page.waitForTimeout(650);
  assert.equal(await page.locator('#scanner').evaluate(dialog=>dialog.open),true,'one physical frame remains unconfirmed');
  assert.equal(await page.locator('#histList .row').count(),0);
  await page.evaluate(()=>window.__cameraTest.push());
  await waitForRegistration(page);
});

test('4K landscape and portrait sources remain readable with bounded decode memory',async t=>{
  for(const [width,height] of [[3840,2160],[2160,3840]]){
    const page=await fixture(t,{width,height,narrow:4});
    await start(page);await waitForRegistration(page);
    const frames=await page.evaluate(()=>window.__decodes);
    assert.ok(frames.length>=2);
    assert.ok(frames.every(frame=>Math.max(frame.width,frame.height)<=2560&&frame.width*frame.height<=2100000));
  }
});

test('supported focus, zoom and torch work; switching and closing release every stream',async t=>{
  const page=await fixture(t,{blank:true});await start(page);
  await page.waitForFunction(()=>!document.querySelector('#cameraZoom').disabled&&!document.querySelector('#switchCamera').hidden);
  assert.equal(await page.locator('#cameraZoom').isVisible(),true);
  assert.equal(await page.locator('#cameraTorch').isVisible(),true);
  assert.ok(await page.evaluate(()=>window.__cameraTest.constraints.some(({value})=>JSON.stringify(value).includes('continuous'))),'autofocus requested when available');
  await page.locator('#cameraZoom').fill('2');await page.locator('#cameraZoom').dispatchEvent('input');
  await page.waitForFunction(()=>window.__cameraTest.streams[0].track.getSettings().zoom===2);
  await page.locator('#cameraTorch').click();
  await page.waitForFunction(()=>window.__cameraTest.streams[0].track.getSettings().torch===true);
  await page.locator('#switchCamera').click();
  await page.waitForFunction(()=>window.__cameraTest.streams.length===2&&document.querySelector('#cameraVideo').readyState>=2);
  assert.equal(await page.evaluate(()=>window.__cameraTest.streams[0].track.readyState),'ended');
  assert.notEqual(await page.evaluate(()=>window.__cameraTest.streams[1].track.getSettings().deviceId),'rear-main');
  for(const viewport of [{width:360,height:640},{width:844,height:390},{width:568,height:320}]){
    await page.setViewportSize(viewport);
    for(const id of ['closeScanner','cameraZoom','cameraTorch','switchCamera','scannerManual']){
      const box=await page.locator('#'+id).boundingBox();assert.ok(box,`${id} visible`);
      assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,`${id} fits ${viewport.width}x${viewport.height}`);
    }
    assert.ok((await page.locator('#cameraView').boundingBox()).height>=100,'camera preview remains usable');
  }
  await page.locator('#closeScanner').click();
  assert.equal(await page.evaluate(()=>window.__cameraTest.streams.every(entry=>entry.track.readyState==='ended')),true);
  assert.equal(await page.locator('#cameraVideo').evaluate(video=>video.srcObject),null);
  assert.equal(await page.locator('#histList .row').count(),0);
});

test('unsupported camera controls stay hidden and optional constraints cannot prevent scanning',async t=>{
  const page=await fixture(t,{unsupported:true,blank:true});await start(page);
  assert.equal(await page.locator('#cameraZoom').isVisible(),false);
  assert.equal(await page.locator('#cameraTorch').isVisible(),false);
  await page.locator('#closeScanner').click();
  const rejecting=await fixture(t,{rejectConstraints:true});await start(rejecting);await waitForRegistration(rejecting);
});

test('a real decode completed after close cannot register or revive the camera',async t=>{
  const page=await fixture(t,{holdDecodeAt:2});
  await start(page);
  await page.waitForFunction(()=>typeof window.__cameraTest.releaseDecode==='function');
  assert.equal(await page.evaluate(()=>window.__decodes.filter(frame=>frame.texts.includes('P009000')).length),2,'hold the confirming result after two actual reads');
  await page.locator('#closeScanner').click();
  await page.evaluate(()=>window.__cameraTest.releaseDecode());
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#histList .row').count(),0);
  assert.equal(await page.locator('#scanner').evaluate(dialog=>dialog.open),false);
  assert.equal(await page.evaluate(()=>window.__cameraTest.streams.every(entry=>entry.track.readyState==='ended')),true);
});
