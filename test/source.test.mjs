import test from 'node:test';
import assert from 'node:assert/strict';
import {startSource} from '../src/source.mjs';
test('本地资料源可复现业务边界',async()=>{
 const source=await startSource();const action=async action=>{const response=await fetch(source.url+'/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})});assert.equal(response.status,200);return response.json();};
 try{const response=await fetch(source.url+'/api/document/capacity');assert.equal(response.headers.get('etag'),'v1');const html=await response.text();assert.ok(html.includes('单位：万吨/年'));assert.ok(html.includes('单位：千吨/年'));assert.ok(html.includes('A1200'));assert.ok(html.includes('待定'));}finally{await source.close();}
});
test('未知控制动作不改变源状态',async()=>{const source=await startSource();try{const before=await(await fetch(source.url+'/api/snapshot')).json();const response=await fetch(source.url+'/api/action',{method:'POST',body:JSON.stringify({action:'not-registered'})});assert.equal(response.status,400);assert.deepEqual(await(await fetch(source.url+'/api/snapshot')).json(),before);}finally{await source.close();}});
