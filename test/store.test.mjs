import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CaptureStore} from '../src/store.mjs';

test('接收记录重新打开后可读且顺序不变', async()=>{
 const root=await mkdtemp(join(tmpdir(),'captures-'));
 try{const path=join(root,'records.json');const store=new CaptureStore(path);assert.equal((await store.read()).revision,0);
 await Promise.all([store.append({id:'a',text:'中文资料'}),store.append({id:'b',value:null})]);
 const state=await new CaptureStore(path).read();assert.equal(state.revision,2);assert.deepEqual(state.records.map(value=>value.id),['a','b']);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('接收文件损坏时不返回伪造空结果',async()=>{
 const root=await mkdtemp(join(tmpdir(),'captures-'));
 try{const path=join(root,'records.json');await writeFile(path,JSON.stringify({body:'{}',checksum:'bad'}));await assert.rejects(new CaptureStore(path).read(),/校验/);}
 finally{await rm(root,{recursive:true,force:true});}
});
