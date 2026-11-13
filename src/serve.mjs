import {startSource} from './source.mjs';
const port = Number(process.env.PORT ?? 0);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 必须是 0 至 65535 的整数');
const source=await startSource({ port });
console.log('本地资料源：'+source.url);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await source.close();process.exit(0);});
