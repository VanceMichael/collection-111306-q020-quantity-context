import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
async function* walk(directory){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=`${directory}/${entry.name}`;
  if(entry.isDirectory())yield* walk(path);
  else if(entry.name.endsWith('.mjs'))yield path;
 }
}
for(const directory of ['src','test','scripts','public']){
 try{for await(const file of walk(directory)){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}}
 catch(error){if(error.code==='ENOENT')continue;throw error;}
}
console.log('模块语法检查通过');
