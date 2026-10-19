(() => {
'use strict';
function delimited(text, delimiter) {
  if (delimiter === 'spaces') return text.split(/\r?\n/).filter(s=>s.trim()).map(s=>s.trim().split(/\s{2,}/));
  const rows=[]; let row=[], value='', quoted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++) { const c=text[i]; if(c==='"') { if(quoted && text[i+1]==='"'){value+='"';i++;} else quoted=!quoted; } else if(!quoted && c===delimiter){row.push(value.trim());value='';} else if(!quoted && (c==='\n'||c==='\r')) { if(c==='\r'&&text[i+1]==='\n')i++;row.push(value.trim()); if(row.some(Boolean))rows.push(row);row=[];value=''; } else value+=c; }
  if(quoted)throw Error('Незакрытые кавычки в таблице'); row.push(value.trim());if(row.some(Boolean))rows.push(row); return rows;
}
function parseText(text, delimiter='auto') {
  if(delimiter==='auto') { const candidates=['\t',';',',','|','spaces']; delimiter=candidates.map(d=>({d,rows:delimited(text,d)})).map(x=>({...x,score:x.rows.slice(0,10).reduce((n,r)=>n+(r.length>1?r.length:0),0)})).sort((a,b)=>b.score-a.score)[0].d; }
  return delimited(text,delimiter);
}
const aliases={region:['регион','город','region','city'],anydesk_id:['anydesk','anydeskid','энидеск','анидеск'],rudesktop_id:['rudesktop','rudesktopid','рудесктоп'],title:['имя','название','name','title','компьютер','устройство','пк','hostname','фи','фио','сотрудник'],remote_id:['id','ид','адрес','ip','address','idподключения','адресподключения'],tool:['программа','program','tool','тип','приложение','клиент'],visibility:['доступ','access','visibility','права']};
const normalize=s=>String(s||'').toLowerCase().replace(/[\s_\-\/]/g,'');
function mapping(row) { const map={};for(const [field,names] of Object.entries(aliases)){map[field]=row.findIndex(v=>names.includes(normalize(v)));}return map; }
function program(value) { return ({anydesk:'AnyDesk',энидеск:'AnyDesk',анидеск:'AnyDesk',rudesktop:'RuDesktop',рудесктоп:'RuDesktop',терминал:'Терминал',terminal:'Терминал',ssh:'Терминал',cmd:'Терминал'})[normalize(value)] || ''; }
async function xlsx(buffer) {
  const data=new Uint8Array(buffer), view=new DataView(buffer), decoder=new TextDecoder(); let end=-1;
  for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw Error('Файл XLSX повреждён');
  const files=new Map(); let offset=view.getUint32(end+16,true), total=0;
  const count=view.getUint16(end+10,true);if(count>3000)throw Error('Слишком сложная книга');
  for(let n=0;n<count;n++){
    if(view.getUint32(offset,true)!==0x02014b50)throw Error('Файл XLSX повреждён');
    const flags=view.getUint16(offset+8,true), method=view.getUint16(offset+10,true), size=view.getUint32(offset+20,true), unpacked=view.getUint32(offset+24,true), length=view.getUint16(offset+28,true), extra=view.getUint16(offset+30,true), comment=view.getUint16(offset+32,true), local=view.getUint32(offset+42,true);
    const name=decoder.decode(data.slice(offset+46,offset+46+length)); offset+=46+length+extra+comment;
    if(!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name))continue;
    total+=unpacked;if(total>30*1024*1024 || flags&1)throw Error('Книга слишком большая или защищена паролем');
    const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);let bytes=data.slice(start,start+size);
    if(method===8){ const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')); const reader=stream.getReader(), chunks=[];let len=0;while(true){const r=await reader.read();if(r.done)break;len+=r.value.length;if(len>unpacked||len>30*1024*1024){await reader.cancel();throw Error('Книга слишком большая');}chunks.push(r.value);}bytes=new Uint8Array(len);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;} } else if(method!==0)throw Error('Неподдерживаемое сжатие XLSX. Сохраните таблицу как CSV');
    const xml=new DOMParser().parseFromString(decoder.decode(bytes),'application/xml');if(xml.querySelector('parsererror'))throw Error('Файл XLSX повреждён');files.set(name,xml);
  }
  const strings=[...(files.get('xl/sharedStrings.xml')?.getElementsByTagName('si')||[])].map(el=>[...el.getElementsByTagName('t')].map(t=>t.textContent).join(''));
  const rels=new Map([...(files.get('xl/_rels/workbook.xml.rels')?.getElementsByTagName('Relationship')||[])].map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
  const sheets=[...(files.get('xl/workbook.xml')?.getElementsByTagName('sheet')||[])];
  return sheets.map(sheet=>{
    const target=rels.get(sheet.getAttribute('r:id')), path=target ? new URL(target,'https://xlsx.invalid/xl/workbook.xml').pathname.slice(1) : '';
    const xml=files.get(path); const rows=[];if(!xml)return {name:sheet.getAttribute('name'),rows};
    for(const row of xml.getElementsByTagName('row')){
      const cells=[];for(const cell of row.getElementsByTagName('c')){
        const ref=cell.getAttribute('r')||'', letters=ref.match(/^[A-Z]+/)?.[0]||'A';let column=0;for(const ch of letters)column=column*26+ch.charCodeAt(0)-64;column--;if(column>49)continue;
        const type=cell.getAttribute('t'), raw=cell.getElementsByTagName('v')[0]?.textContent||'';
        cells[column]=type==='s' ? strings[Number(raw)]||'' : type==='inlineStr' ? [...cell.getElementsByTagName('t')].map(t=>t.textContent).join('') : raw;
      } if(cells.some(v=>v?.trim()))rows.push(Array.from({length:cells.length},(_,i)=>cells[i]||''));if(rows.length>501)throw Error('До 500 записей за один импорт. Разделите таблицу на части');
    }return {name:sheet.getAttribute('name'),rows};
  }).filter(s=>s.rows.length);
}
window.wikiImport={parseText,mapping,program,xlsx};
})();
