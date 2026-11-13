import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
for(const directory of ['src','test','scripts','public']){
 let entries;try{entries=await readdir(directory);}catch(error){if(error.code==='ENOENT')continue;throw error;}
 for(const entry of entries.filter(value=>value.endsWith('.mjs'))){const result=spawnSync(process.execPath,['--check',`${directory}/${entry}`],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}
}
console.log('模块语法检查通过');
