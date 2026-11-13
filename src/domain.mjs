export function rawText(html){return html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();}
export function preview(data){return data.pages.map(page=>({id:page.id,text:rawText(page.html),version:data.version}));}
