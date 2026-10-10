/** Capture real browser states from actual clicks, without any external requests. */
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
 const out=path.join(__dirname,'browser-captures');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--disable-background-networking']});
 const page=await browser.newPage({viewport:{width:1000,height:1150},deviceScaleFactor:1});
 await page.route('**/*',r=>r.request().url().startsWith('file:')?r.continue():r.abort());
 await page.goto('file://'+path.join(__dirname,'demo.html'));
 await page.addStyleTag({content:`
 body{padding:24px;font-size:24px}main{max-width:920px}h1{font-size:44px;margin:22px 0}
 main>p,main>small{display:none}section{padding:26px;margin:20px 0}h2{font-size:34px}
 button{font-size:26px;padding:16px}output{font-size:36px}.metrics{gap:45px}
 #trace{font-size:26px;line-height:1.35;margin-top:20px}#tests{font-size:26px}
 `});
 const shot=async name=>page.screenshot({path:path.join(out,name+'.png')});
 await shot('ready');
 await page.locator('#run').click();
 if(await page.locator('#charged').textContent()!=='$480')throw Error('Unsafe charge mismatch');
 await shot('booked');
 await page.locator('#reset').click();await page.locator('#hint').check();await shot('patched');
 await page.locator('#run').click();
 if(await page.locator('#status').textContent()!=='CONFIRMATION REQUIRED')throw Error('Confirmation missing');
 await shot('waiting');
 await page.locator('#reject').click();
 if(await page.locator('#charged').textContent()!=='$0')throw Error('Rejection effect mismatch');
 await shot('rejected');
 const proof=await page.evaluate(()=>window.testAll());
 await page.locator('#tests').click();await page.locator('#trace').scrollIntoViewIfNeeded();await shot('tests');
 fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify({...proof,actualBrowserClicks:true},null,2)+'\n');
 await browser.close();console.log('Captured six real demo states and four passing assertions');
})().catch(e=>{console.error(e);process.exit(1)});
