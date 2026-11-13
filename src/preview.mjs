import {resolve} from 'node:path';
import {startSource} from './source.mjs';
import {CaptureStore} from './store.mjs';
import {preview} from './domain.mjs';
const source=await startSource();let browser;
try{
 const observed=preview(await(await fetch(source.url+'/api/snapshot')).json());
 const path=resolve(process.env.CAPTURE_PATH??'var/captures.json');const store=new CaptureStore(path);
 const receipt=await store.append({kind:"quantity-context",observed,at:new Date().toISOString()});
 console.log(JSON.stringify({资料源:source.url,接收文件:path,已存记录:receipt.revision,本次预览:observed},null,2));
}finally{if(browser)await browser.close();await source.close();}
