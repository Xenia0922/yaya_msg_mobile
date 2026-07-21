const https = require('https');
function get(url){return new Promise((res,rej)=>{const o={headers:{'User-Agent':'Mozilla/5.0'}};https.get(url,o,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
function extract(t, v){
  const ai=t.indexOf(v); if(ai<0)return null;
  const os=t.indexOf('{',ai), as=t.indexOf('[',ai);
  const vs=(as>=0&&(os<0||as<os))?as:os; if(vs<0)return null;
  const st=[]; let inS=false,esc=false;
  for(let i=vs;i<t.length;i++){const c=t[i];
    if(inS){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')inS=false;continue;}
    if(c==='"')inS=true; else if(c==='['||c==='{')st.push(c);
    else if(c===']'||c==='}'){st.pop();if(st.length===0){try{return JSON.parse(t.slice(vs,i+1));}catch(e){return null;}}}}
  return null;
}
const norm=s=>String(s||'').trim().toLowerCase().replace(/[\s（）()【】\[\]！!?？.,·、]/g,'');
const nm=u=>{const t=String(u||'').trim();if(!t)return'';if(t.startsWith('//'))return`https:${t}`;if(t.startsWith('http://'))return t.replace(/^http:/i,'https:');if(t.startsWith('/'))return`https://www.snh48.com${t}`;return t;};
function collectRecordItems(v,r=[]){if(Array.isArray(v))v.forEach(i=>collectRecordItems(i,r));else if(v&&typeof v==='object'){if(v.title&&v.image)r.push(v);Object.keys(v).forEach(k=>{if(k!=='title'&&k!=='image')collectRecordItems(v[k],r);});}return r;}
function buildRecordMap(rd){const m=new Map();const recs=[];collectRecordItems(rd).forEach(r=>{const t=String(r.title||'').trim();if(!t)return;const ri={title:t,image:nm(r.image),url:nm(r.url),team:String(r.team||'').trim()};recs.push(ri);m.set(t,ri);m.set(norm(t),ri);});m.set('__records',recs);return m;}
function findRecordForAlbum(m,alb){if(!alb)return null;const na=norm(alb);const ex=m.get(alb)||m.get(na);if(ex)return ex;const recs=m.get('__records')||[];return recs.find(r=>{const nt=norm(r.title);return nt&&(na.includes(nt)||nt.includes(na));})||null;}
function getAudioGroupKey(url,gk=''){const fn=String(url||'').split('/').pop()||'';const bn=fn.replace(/\.mp3$/i,'');const ng=bn.replace(/_?\d+$/i,'');if(ng!==bn)return ng||bn;if(gk==='BEJ'&&bn.includes('_'))return bn.split('_')[0]||bn;return bn||fn;}
function buildAudioGroups(list,gk=''){const gs=new Map();let cg=null;(Array.isArray(list)?list:[]).forEach(it=>{const k=getAudioGroupKey(it&&it.mp3,gk);if(!cg||cg.groupKey!==k){cg={groupKey:k,title:(it&&it.title)||'',count:0};gs.set(k,cg);}cg.count++;});return gs;}
const SNH=new Map([['fly','F.L.Y成长三部曲'],['wmlc','我们的旅程'],['newyear','新年的钟声'],['bluelight','新年的钟声'],['banoil','新年的钟声'],['dudubaby','新年的钟声'],['gogirl','新年的钟声'],['gayni','新年的钟声'],['kyt','苦与甜'],['myself','盛夏好声音'],['kissing','盛夏好声音'],['speedeye','盛夏好声音'],['philosophy','盛夏好声音'],['afterrain','雨季之后'],['diary','雨季之后'],['sha','雨季之后'],['planetreeh','雨季之后'],['wolf','雨季之后'],['gaobai','青春的约定'],['gravita','青春的约定'],['suki','青春的约定'],['dreamriver','青春的约定'],['planetree','呜吒（UZA）'],['rabit','呜吒（UZA）'],['miss','呜吒（UZA）'],['sunset','呜吒（UZA）'],['solong','一心向前'],['sakurasiori','一心向前'],['wind','一心向前'],['megami','一心向前'],['hr_n','无尽旋转【蓝版】'],['fg_n','一心向前'],['river_n','一心向前'],['boni_n','一心向前'],['down','心电感应'],['love','心电感应'],['sunrise','心电感应'],['blackwhite','心电感应'],['chrismas','爱的幸运曲奇'],['maybe','爱的幸运曲奇'],['beginner','爱的幸运曲奇'],['boni','飞翔入手'],['shitou','飞翔入手'],['river','无尽旋转'],['sakura','无尽旋转']]);
function buildTracks(group,list,rm,srm){
  const sl=[];const seen=new Set();(Array.isArray(list)?list:[]).forEach(it=>{const mp3=nm(it&&it.mp3).toLowerCase();const ti=String(it&&it.title||'').trim();const ar=String(it&&it.artist||'').trim();const k=`${mp3}|${ti}|${ar}`;if(!mp3||seen.has(k))return;seen.add(k);sl.push(it);});
  const ac=new Map();sl.forEach(it=>{const a=String(it&&it.artist||'').trim();if(a)ac.set(a,(ac.get(a)||0)+1);});
  const useful=ac.size>1||sl.length<=10;const ags=buildAudioGroups(sl,group.key);
  return sl.map((it,idx)=>{
    const mp3=nm(it&&it.mp3);if(!mp3)return null;
    const agk=getAudioGroupKey(it&&it.mp3,group.key);const ag=ags.get(agk);
    const sm=srm.get(nm(it&&it.mp3).toLowerCase())||srm.get('title:'+norm(it&&it.title))||null;
    const ern=(sm&&sm.recordName)||(group.key==='SNH'?SNH.get(agk)||'':'')||'';
    const tr=findRecordForAlbum(rm,it&&it.title);
    let album='',rec=null;
    if(ern){album=ern;rec=findRecordForAlbum(rm,ern)||tr;}
    else if(useful){album=(it&&it.artist)||'';rec=findRecordForAlbum(rm,album)||tr;}
    else if(group.key==='GNZ'&&tr){album=tr.title;rec=tr;}
    else{const ia=(ag&&ag.title)||'';const ir=findRecordForAlbum(rm,ia)||tr;if(ir){album=ia;rec=ir;}}
    if(rec&&rec.title)album=rec.title;
    const singer=(rec&&rec.team)||group.label;
    return {title:(it&&it.title)||'?',album,singer,cover:rec&&rec.image?rec.image.slice(0,50):'(none)'};
  }).filter(Boolean);
}
(async()=>{
  const t=await get('https://www.snh48.com/js/json_data_snh.js');
  const list=extract(t,'ix_mp3list_snh');
  const rm=buildRecordMap(extract(t,'records_snh'));
  const srm=new Map();
  const tracks=buildTracks({key:'SNH',label:'SNH48'},list,rm,srm);
  console.log('TOTAL SNH tracks:',tracks.length);
  console.log('DISTINCT albums:',new Set(tracks.map(x=>x.album)).size);
  console.log('DISTINCT singers:',new Set(tracks.map(x=>x.singer)).size);
  console.log('with cover:',tracks.filter(x=>x.cover!=='(none)').length);
  console.log('still 热恋专属 as album? count=',tracks.filter(x=>x.album.includes('热恋专属')).length);
  console.log('--- SAMPLES ---');
  tracks.slice(0,10).forEach((x,i)=>console.log(i,x.title,'|',x.album,'|',x.singer,'|',x.cover));
  console.log('--- albums sample ---');
  [...new Set(tracks.map(x=>x.album))].slice(0,15).forEach(a=>console.log('  ',a));
})().catch(e=>{console.error(e);});
