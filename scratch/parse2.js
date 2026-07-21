const https = require('https');
function get(url){return new Promise((res,rej)=>{const o={headers:{'User-Agent':'Mozilla/5.0'}};https.get(url,o,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
function extract(scriptText, variableName){
  const ai = scriptText.indexOf(variableName);
  if(ai<0) return null;
  const os = scriptText.indexOf('{', ai);
  const as = scriptText.indexOf('[', ai);
  const vs = (as>=0 && (os<0||as<os))?as:os;
  if(vs<0) return null;
  const stack=[]; let inStr=false,esc=false;
  for(let i=vs;i<scriptText.length;i++){
    const c=scriptText[i];
    if(inStr){ if(esc)esc=false; else if(c==='\\')esc=true; else if(c==='"')inStr=false; continue;}
    if(c==='"')inStr=true;
    else if(c==='['||c==='{')stack.push(c);
    else if(c===']'||c==='}'){stack.pop(); if(stack.length===0){try{return JSON.parse(scriptText.slice(vs,i+1));}catch(e){return null;}}}
  }
  return null;
}
(async()=>{
  // Dump full records_snh
  const t = await get('https://www.snh48.com/js/json_data_snh.js');
  const rec = extract(t,'records_snh');
  if(rec && rec.SNH){
    console.log('=== records_snh.SNH count:', rec.SNH.length, '===');
    rec.SNH.forEach((r,i)=>console.log(i, JSON.stringify(r).slice(0,260)));
  } else { console.log('records_snh raw type:', typeof rec, JSON.stringify(rec).slice(0,200)); }

  // Check GNZ structure - maybe richer
  const g = await get('https://www.snh48.com/js/json_data_gnz.js');
  const gl = extract(g,'ix_mp3list_gnz');
  console.log('\n=== GNZ list len:', Array.isArray(gl)?gl.length:'n/a', '===');
  if(Array.isArray(gl)&&gl[0]) console.log('GNZ[0] keys:', Object.keys(gl[0]).join(','), JSON.stringify(gl[0]).slice(0,300));
  const gart = new Set((gl||[]).map(x=>String(x.artist||'')));
  console.log('GNZ distinct artist:', gart.size, [...gart].slice(0,8).join(' | '));
})().catch(e=>{console.error('ERR',e);});
