const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');

const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
// Observe the actual embedded WASM reader without substituting its results.
const instrumented=html.replace('readBarcodes=mod.readBarcodes;',`window.__originalReader=mod.readBarcodes;window.__readerOptions=READER_OPTS;window.__enhanceContrast=enhanceContrast;
readBarcodes=async (input,options)=>{
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
    function picture(){
      const canvas=document.createElement('canvas');
      canvas.width=options.width||1920;canvas.height=options.height||1080;
      const ctx=canvas.getContext('2d');
      const light=options.light??(options.lowContrast?162:255),dark=options.dark??(options.lowContrast?112:0);
      ctx.fillStyle=`rgb(${light},${light},${light})`;
      ctx.fillRect(0,0,canvas.width,canvas.height);
      if(!options.blank){
        const bars=document.createElement('canvas');bars.width=canvas.width;bars.height=canvas.height;
        const barContext=bars.getContext('2d');
        const narrow=options.narrow||3,code='*P009000*';
        const barWidth=(code.length*16-1)*narrow;
        let x=Math.floor((canvas.width-barWidth)/2);
        const height=options.edge?Math.max(70,Math.floor(canvas.height*.08)):140;
        const y=options.edge?Math.floor(canvas.height*.04):Math.floor((canvas.height-height)/2);
        barContext.fillStyle=`rgb(${dark},${dark},${dark})`;
        for(const char of code){
          for(let i=0;i<9;i++){
            const width=narrow*((patterns[char]&(1<<(8-i)))?3:1);
            if(i%2===0)barContext.fillRect(x,y,width,height);
            x+=width;
          }
          x+=narrow;
        }
        ctx.filter=`blur(${options.blur||0}px)`;ctx.drawImage(bars,0,0);ctx.filter='none';
      }
      return canvas;
    }
    state.picture=picture;
    const fixturePicture=picture();
    function draw(canvas,frame){
      const ctx=canvas.getContext('2d');ctx.drawImage(fixturePicture,0,0);
      // Ensure every requested frame has a distinct image/timestamp.
      ctx.fillStyle=frame%2?'#e1e1e1':'#eeeeee';ctx.fillRect(0,0,2,2);
    }
    navigator.mediaDevices.enumerateDevices=async()=>[
      {kind:'videoinput',deviceId:'rear-main',label:'Back Camera'},
      {kind:'videoinput',deviceId:'rear-tele',label:'Back Telephoto Camera'},
      {kind:'videoinput',deviceId:'front',label:'Front Camera'},
    ];
    const supportedConstraints=navigator.mediaDevices.getSupportedConstraints();
    navigator.mediaDevices.getSupportedConstraints=()=>({...supportedConstraints,pointsOfInterest:options.pointsOfInterest===true});
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
        focusMode:options.focusModes||['manual','single-shot','continuous'],exposureMode:['continuous'],whiteBalanceMode:['continuous'],
        zoom:{min:1,max:4,step:.1},torch:true,
      };
      track.applyConstraints=async value=>{
        state.constraints.push({deviceId,value});
        if(options.rejectConstraints)throw new DOMException('Optional control unsupported','OverconstrainedError');
        if(options.rejectContinuous&&value.advanced?.some(setting=>setting.focusMode==='continuous'))throw new DOMException('Continuous focus unsupported','OverconstrainedError');
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

// Keep the former four camera passes as a comparison for difficult fixtures.
// The production reader is unmodified; only the old preprocessing is recreated.
async function oldCameraPasses(page){
  return page.evaluate(async()=>{
    const source=window.__cameraTest.picture(),results=[];
    for(let pass=0;pass<4;pass++){
      const full=pass>=2,width=source.width,height=source.height;
      const sy=full?0:Math.round(height*.2),sh=full?height:Math.round(height*.6);
      const scale=Math.min(1,2560/Math.max(width,sh),Math.sqrt(2000000/(width*sh)));
      const canvas=document.createElement('canvas');canvas.width=Math.floor(width*scale);canvas.height=Math.floor(sh*scale);
      const ctx=canvas.getContext('2d');ctx.drawImage(source,0,sy,width,sh,0,0,canvas.width,canvas.height);
      const frame=ctx.getImageData(0,0,canvas.width,canvas.height);
      if(pass%2===1){
        const data=frame.data;
        for(let i=0;i<data.length;i+=4){
          const gray=Math.round(data[i]*.299+data[i+1]*.587+data[i+2]*.114);
          data[i]=data[i+1]=data[i+2]=Math.max(0,Math.min(255,Math.round((gray-128)*1.7+128)));
        }
      }
      results.push((await window.__originalReader(frame,{...window.__readerOptions,tryDownscale:false})).map(result=>result.text));
    }
    return results;
  });
}

test('automatic detail processing reads blurred one-pixel bars lost by the former resize passes',async t=>{
  const page=await fixture(t,{width:3840,height:2160,narrow:1,blur:.5});
  assert.equal((await oldCameraPasses(page)).flat().includes('P009000'),false,'former resized camera passes cannot read this fixture');
  await start(page);await waitForRegistration(page);
});

test('automatic contrast processing recovers pale blurred bars that raw and fixed contrast miss',async t=>{
  for(const [width,height] of [[1920,1080],[1080,1920]]){
    const page=await fixture(t,{width,height,narrow:2,blur:.6,dark:225,light:240});
    assert.equal((await oldCameraPasses(page)).flat().includes('P009000'),false,'former raw and fixed-contrast passes cannot read this fixture');
    await start(page);await waitForRegistration(page);
  }
});

test('contrast recovery handles gray labels and preserves bright and dark barcode details',async t=>{
  for(const [dark,light] of [[130,140],[210,235],[20,40]]){
    const page=await fixture(t,{narrow:2,dark,light});
    const previous=await oldCameraPasses(page);
    assert.equal(previous[1].includes('P009000')||previous[3].includes('P009000'),false,'the former fixed enhancement fails on this exposure');
    if(dark===130)assert.equal(previous.flat().includes('P009000'),false,'raw decoding also fails on the low-contrast gray label');
    const recovered=await page.evaluate(async()=>{
      const source=window.__cameraTest.picture();
      const frame=source.getContext('2d').getImageData(0,0,source.width,source.height);
      return (await window.__originalReader(window.__enhanceContrast(frame),{...window.__readerOptions,tryDownscale:false})).map(result=>result.text);
    });
    assert.ok(recovered.includes('P009000'),'production contrast preprocessing preserves real barcode details');
    if(dark===130){await start(page);await waitForRegistration(page);}
  }
});

test('real WASM reads a low-contrast barcode outside the central crop in landscape and portrait',async t=>{
  for(const [width,height] of [[1920,1080],[1080,1920]]){
    const page=await fixture(t,{width,height,edge:true,lowContrast:true});
    await start(page);await waitForRegistration(page);
    const frames=await page.evaluate(()=>window.__decodes);
    assert.ok(frames.some(frame=>frame.texts.includes('P009000')),'real barcode decoded');
    assert.ok(frames.some(frame=>Math.abs(frame.width/frame.height-width/height)<.01&&frame.texts.includes('P009000')),'full-frame fallback reads a barcode outside the crop');
    assert.ok(frames.every(frame=>Math.max(frame.width,frame.height)<=3840&&frame.width*frame.height<=1200000),'decode frames have a bounded pixel budget');
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
    assert.ok(frames.every(frame=>Math.max(frame.width,frame.height)<=3840&&frame.width*frame.height<=1200000));
  }
});

test('focus is automatic with no zoom, light or camera switching controls; close releases the camera',async t=>{
  const page=await fixture(t,{blank:true});await start(page);
  await page.waitForFunction(()=>window.__cameraTest.constraints.some(({value})=>JSON.stringify(value).includes('continuous')));
  assert.equal(await page.locator('#cameraControls,#cameraZoom,#cameraTorch,#switchCamera').count(),0,'removed controls are absent from the DOM');
  assert.equal(await page.evaluate(()=>window.__cameraTest.constraints.some(({value})=>/zoom|torch/.test(JSON.stringify(value)))),false,'automatic focus does not change zoom or torch');
  assert.equal(await page.evaluate(()=>window.__cameraTest.streams.length),1);
  for(const viewport of [{width:360,height:640},{width:844,height:390},{width:568,height:320}]){
    await page.setViewportSize(viewport);
    await page.waitForFunction(()=>{
      const video=document.querySelector('#cameraVideo'),view=document.querySelector('#cameraView').getBoundingClientRect();
      const guide=document.querySelector('#cameraGuide').getBoundingClientRect();
      const scale=Math.min(view.width/video.videoWidth,view.height/video.videoHeight);
      const width=video.videoWidth*scale,height=video.videoHeight*scale;
      const x=view.x+(view.width-width)/2,y=view.y+(view.height-height)/2;
      return guide.x>=x-1&&guide.y>=y-1&&guide.right<=x+width+1&&guide.bottom<=y+height+1&&
        Math.abs(guide.x+guide.width/2-view.x-view.width/2)<1&&Math.abs(guide.y+guide.height/2-view.y-view.height/2)<1;
    });
    for(const id of ['closeScanner','scannerManual']){
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

test('missing or rejected optional focus settings cannot prevent scanning',async t=>{
  const page=await fixture(t,{unsupported:true,blank:true});await start(page);
  assert.equal(await page.locator('#cameraControls,#cameraZoom,#cameraTorch,#switchCamera').count(),0);
  assert.equal(await page.evaluate(()=>window.__cameraTest.constraints.length),0);
  await page.locator('#closeScanner').click();
  const rejecting=await fixture(t,{rejectConstraints:true});await start(rejecting);await waitForRegistration(rejecting);
});

test('supported center focus preserves continuous autofocus while real WASM reads without reopening the camera',async t=>{
  const page=await fixture(t,{pointsOfInterest:true});await start(page);await waitForRegistration(page);
  const state=await page.evaluate(()=>({
    requests:window.__cameraTest.requests.length,
    streams:window.__cameraTest.streams.length,
    settings:window.__cameraTest.streams[0].track.getSettings(),
    constraints:window.__cameraTest.constraints.map(entry=>entry.value),
  }));
  assert.equal(state.requests,1);assert.equal(state.streams,1);
  assert.equal(state.settings.focusMode,'continuous');
  assert.deepEqual(state.settings.pointsOfInterest,[{x:.5,y:.5}]);
  assert.ok(state.constraints.some(value=>value.advanced?.some(setting=>setting.pointsOfInterest)),'supported center point is requested');
  assert.equal(state.constraints.some(value=>value.advanced?.some(setting=>setting.focusMode==='single-shot')),false,'successful continuous autofocus does not trigger single-shot');
});

test('single-shot fallback runs once after center and exposure setup while real WASM continues reading',async t=>{
  for(const options of [
    {focusModes:['manual','single-shot']},
    {focusModes:['manual','single-shot','continuous'],rejectContinuous:true},
  ]){
    const page=await fixture(t,{...options,pointsOfInterest:true});await start(page);await waitForRegistration(page);
    const state=await page.evaluate(()=>({
      requests:window.__cameraTest.requests.length,
      streams:window.__cameraTest.streams.length,
      settings:window.__cameraTest.streams[0].track.getSettings(),
      constraints:window.__cameraTest.constraints.map(entry=>entry.value),
    }));
    assert.equal(state.requests,1);assert.equal(state.streams,1);
    const singleShots=state.constraints.filter(value=>value.advanced?.some(setting=>setting.focusMode==='single-shot'));
    assert.equal(singleShots.length,1,'later optional settings cannot retrigger single-shot focus');
    assert.equal(state.constraints.at(-1),singleShots[0],'single-shot is the final camera adjustment');
    assert.equal(state.settings.focusMode,'single-shot');
    assert.equal(state.settings.exposureMode,'continuous');
    assert.deepEqual(state.settings.pointsOfInterest,[{x:.5,y:.5}]);
  }
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
