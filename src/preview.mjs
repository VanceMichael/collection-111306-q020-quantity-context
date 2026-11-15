import {resolve} from 'node:path';
import {startSource} from './source.mjs';
import {CaptureStore} from './store.mjs';
import {preview} from './domain.mjs';
import {collectDocuments} from './collect.mjs';
const source=await startSource();
try{
 const observed=preview(await(await fetch(source.url+'/api/snapshot')).json());
 const path=resolve(process.env.CAPTURE_PATH??'var/captures.json');const store=new CaptureStore(path);
 await store.append({kind:"quantity-context",observed,at:new Date().toISOString()});
 const collected=await collectDocuments({sourceUrl:source.url,store});
 const state=await store.read();
 const 本次接收=collected.map(({record})=>({
  公告:record.source.documentId,文稿版本:record.source.version,规则:record.ruleVersion,
  表达分类:record.summary.byKind,待核:record.summary.pending,明确未知:record.summary.unknowns,非数量排除:record.summary.nonQuantities,
 }));
 console.log(JSON.stringify({资料源:source.url,接收文件:path,已存记录:state.revision,本次预览:observed,本次接收,提示:'npm run explain -- <编号> 查看某条数量表达的原文、依据、语义、标准化值与历史解释'},null,2));
}finally{await source.close();}
