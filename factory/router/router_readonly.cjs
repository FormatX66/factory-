const { chromium } = require('C:\\Users\\bruce\\FactoryDev\\node_modules\\playwright-core');
const { spawnSync } = require('child_process');
const PY='C:\\Users\\bruce\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
const CREDS='C:\\Users\\bruce\\AurumConnectivity\\factory\\router\\router_credentials.py';
const ALLOWED_HOSTS=new Set(['192.168.0.1','96.253.70.197']);
const host=process.env.AURUM_ROUTER_HOST || '192.168.0.1';
if(!ALLOWED_HOSTS.has(host)){ console.log(JSON.stringify({ok:false,error:'router_host_not_allowed'})); process.exit(3); }
const py = "import importlib.util; s=importlib.util.spec_from_file_location('rc',r'"+CREDS.replace(/\\/g,'\\\\')+"'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m._read_secret(), end='')";
const secretProc=spawnSync(PY,['-c',py],{encoding:'utf8',windowsHide:true,maxBuffer:4096});
if(secretProc.status!==0 || !secretProc.stdout){ console.log(JSON.stringify({ok:false,error:'credential_read_failed'})); process.exit(2); }
let secret=secretProc.stdout;
(async()=>{
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
  const context=await browser.newContext({ignoreHTTPSErrors:true});
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.protocol==='https:' && u.hostname===host) return route.continue();
    return route.abort();
  });
  const page=await context.newPage();
  const resp=await page.goto('https://'+host+'/webpages/index.html',{waitUntil:'domcontentloaded',timeout:15000});
  await page.locator('input[type=password]:visible').waitFor({timeout:10000});
  await page.locator('input[type=password]:visible').fill(secret);
  secret=null;
  await page.getByRole('button',{name:/log in/i}).click();
  await page.waitForFunction(()=>document.body.innerText.includes('Log Out'),null,{timeout:15000});
  const body=await page.locator('body').innerText();
  console.log(JSON.stringify({ok:true,authenticated:true,http_status:resp?.status()||null,title:await page.title(),logout_visible:body.includes('Log Out'),route:host==='192.168.0.1'?'local_https':'wan_https_from_lan'}));
  await context.close();
 }catch(e){
  secret=null;
  console.log(JSON.stringify({ok:false,error:e?.name||'connector_error',route:host==='192.168.0.1'?'local_https':'wan_https_from_lan'}));
  process.exitCode=1;
 }finally{ if(browser) await browser.close(); }
})();