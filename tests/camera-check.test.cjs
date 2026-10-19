const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const zlib=require('node:zlib');
const {chromium}=require('playwright');

const root=path.join(__dirname,'..');
const indexHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
const checkHtml=fs.readFileSync(path.join(root,'camera-check.html'),'utf8');

function block(source,start){
  const from=source.indexOf(start);
  assert.ok(from>=0,start+' exists');
  const end=source.indexOf('\n}',from);
  return source.slice(from,source.indexOf('\n',end+2)).replace(/\s+/g,'');
}

test('diagnosis uses the same reader options and frame processing as the app',()=>{
  for(const start of ['const MACHINE_CODE_RE=','function enhanceContrast(','function cameraFrameArea(','function pickMachineBarcode(','async function cameraPhotoSize(']){
    const head=start==='const MACHINE_CODE_RE='?s=>s.slice(s.indexOf(start)).split('\n')[0]:s=>block(s,start);
    assert.equal(head(checkHtml),head(indexHtml),start);
  }
  const options=s=>s.slice(s.indexOf('const READER_OPTS={'),s.indexOf('};',s.indexOf('const READER_OPTS={'))).replace(/\s+/g,'');
  assert.equal(options(checkHtml),options(indexHtml));
});

test('the app page does not link to the diagnosis page',()=>{
  assert.equal(indexHtml.includes('camera-check'),false);
});

// Code 39 "*P009000*": nine elements, 3:1 wide:narrow.
const patterns={'*':0x094,P:0x052,0:0x034,9:0x064};
function barcodeLuma(width,height,narrow){
  const luma=Buffer.alloc(width*height,255);
  const code='*P009000*', total=(code.length*16-1)*narrow;
  let x=Math.floor((width-total)/2);
  const top=Math.floor(height*.42), bottom=Math.floor(height*.58);
  for(const char of code){
    for(let i=0;i<9;i++){
      const w=narrow*((patterns[char]&(1<<(8-i)))?3:1);
      if(i%2===0) for(let y=top;y<bottom;y++) luma.fill(0,y*width+x,y*width+x+w);
      x+=w;
    }
    x+=narrow;
  }
  return luma;
}
function writeY4m(file,width,height){
  const luma=barcodeLuma(width,height,3), chroma=Buffer.alloc(width*height/2,128);
  const frame=Buffer.concat([Buffer.from('FRAME\n'),luma,chroma]);
  fs.writeFileSync(file,Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`),frame,frame]));
}
function png(width,height){
  const luma=barcodeLuma(width,height,4), rows=[];
  for(let y=0;y<height;y++) rows.push(Buffer.from([0]),luma.subarray(y*width,(y+1)*width));
  const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
  const crc=buffer=>{let c=0xffffffff;for(const b of buffer)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const body=Buffer.concat([Buffer.from(type),data]);const out=Buffer.alloc(body.length+8);out.writeUInt32BE(data.length,0);body.copy(out,4);out.writeUInt32BE(crc(body),body.length+4);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}

let server,url,browser,dir;
before(async()=>{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'camera-check-'));
  writeY4m(path.join(dir,'barcode.y4m'),1280,720);
  server=http.createServer((req,res)=>{
    const name=new URL(req.url,'http://x').pathname.slice(1);
    if(!['index.html','camera-check.html'].includes(name)){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(name==='index.html'?indexHtml:checkHtml);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  url=`http://127.0.0.1:${server.address().port}/`;
  browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
    '--use-file-for-fake-video-capture='+path.join(dir,'barcode.y4m')]});
});
after(async()=>{
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  if(dir)fs.rmSync(dir,{recursive:true,force:true});
});

test('diagnosis measures the real camera stream with the embedded reader and a chosen photo',{timeout:120000},async t=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  t.after(()=>context.close());
  await context.grantPermissions(['camera'],{origin:url});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url+'camera-check.html?phaseMs=1500&prepareMs=50');
  await page.waitForFunction(()=>document.getElementById('startBtn').textContent==='診断を開始',null,{timeout:60000});
  await page.click('#startBtn');
  await page.waitForFunction(()=>/"finishedAt"/.test(document.getElementById('report').value),null,{timeout:90000});
  const report=JSON.parse(await page.inputValue('#report'));
  assert.ok(report.app.indexSha256.length===16);
  assert.ok(report.cameras.length>=1);
  const camera=report.cameras[0];
  assert.equal(camera.appDefault,true);
  assert.equal(camera.error,undefined);
  assert.equal(camera.videoWidth,1280);
  assert.ok(camera.phases.length>=2);
  for(const phase of camera.phases){
    assert.ok(phase.decodes>0,phase.name);
    assert.ok(phase.hits>0,phase.name);
    assert.ok(phase.results.some(result=>result.picked==='P009000'));
    assert.ok(Number.isFinite(phase.sharpnessBest));
  }
  assert.ok(camera.phases.some(phase=>phase.appWouldRegister));
  // Chromium's real ImageCapture returns the file-backed camera frame; the diagnosis decodes the returned Blob.
  assert.equal(camera.photo.error,undefined);
  assert.ok(camera.photo.width>0&&camera.photo.height>0);
  assert.equal(camera.photo.text,'P009000');
  assert.equal(camera.settings.deviceId.length,12,'device identifiers are shortened');
  // The camera is released after the diagnosis.
  assert.equal(await page.evaluate(()=>document.getElementById('video').srcObject),null);

  await page.setInputFiles('#photoInput',{name:'native.png',mimeType:'image/png',buffer:png(1600,1200)});
  await page.waitForFunction(()=>JSON.parse(document.getElementById('report').value).nativePhotos[0]?.analyzeMs!=null,null,{timeout:30000});
  const after=JSON.parse(await page.inputValue('#report'));
  assert.equal(after.nativePhotos[0].text,'P009000');
  assert.equal(after.nativePhotos[0].width,1600);
  assert.match(await page.textContent('#summary'),/選んだ写真 1600×1200: 読取 P009000/);
  const download=page.waitForEvent('download');
  await page.click('#saveBtn');
  assert.match((await download).suggestedFilename(),/^camera-check-\d+\.jpg$/);
  assert.deepEqual(errors,[]);
});

test('leaving the page aborts the diagnosis, reports it and releases the camera',{timeout:120000},async t=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  t.after(()=>context.close());
  await context.grantPermissions(['camera'],{origin:url});
  const page=await context.newPage();
  await page.goto(url+'camera-check.html?phaseMs=4000&prepareMs=50');
  await page.waitForFunction(()=>document.getElementById('startBtn').textContent==='診断を開始',null,{timeout:60000});
  await page.click('#startBtn');
  await page.waitForFunction(()=>document.getElementById('video').srcObject?.active===true,null,{timeout:30000});
  const tracks=await page.evaluateHandle(()=>document.getElementById('video').srcObject.getTracks());
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>/"finishedAt"/.test(document.getElementById('report').value),null,{timeout:60000});
  const report=JSON.parse(await page.inputValue('#report'));
  assert.equal(report.aborted,'画面を離れたため中断');
  assert.equal(report.cameras.length,1,'no further cameras are opened');
  assert.deepEqual(await tracks.evaluate(list=>list.map(track=>track.readyState)),['ended']);
  assert.match(await page.textContent('#summary'),/結果は不完全です/);
});
