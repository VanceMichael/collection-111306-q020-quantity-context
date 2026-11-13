import {startSource} from './source.mjs';
const source=await startSource();
console.log('本地资料源：'+source.url);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await source.close();process.exit(0);});
