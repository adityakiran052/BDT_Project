export function searchSelector(user, filters, q) {
  const selector={type:'document',...filters}, clauses=[];
  if(user.role==='student') selector.status='approved';
  if(user.role==='faculty') clauses.push({$or:[{status:'approved'},{owner:user._id}]});
  if(q) { const escaped=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); clauses.push({$or:['title','subject','description'].map(field=>({[field]:{$regex:'(?i)'+escaped}}))}); }
  if(clauses.length) selector.$and=clauses;
  return selector;
}
export class MemoryStore {
  records = new Map();
  tombstones = new Map();
  async init() {}
  async get(id) { const d = this.records.get(id); if (!d) throw Object.assign(new Error('Record not found'), {status:404}); return structuredClone(d); }
  async put(d) { const old=this.records.get(d._id),revision=old?._rev||this.tombstones.get(d._id); if(old && revision!==d._rev) throw Object.assign(new Error('Record changed. Refresh and retry.'),{status:409}); const next={...d,_rev:String(Number(revision||0)+1)}; this.records.set(d._id,structuredClone(next));this.tombstones.delete(d._id); return next; }
  async query(filters={}) { return [...this.records.values()].filter(d=>Object.entries(filters).every(([k,v])=>d[k]===v)).map(d=>structuredClone(d)); }
  async file(d) { return Buffer.from(d._attachments.file.data,'base64'); }
  async remove(d) {const current=await this.get(d._id);if(current._rev!==d._rev)throw Object.assign(new Error('Record changed. Refresh and retry.'),{status:409});this.records.delete(d._id);this.tombstones.set(d._id,String(Number(d._rev)+1));}
  async deletedRevision(id) {return this.tombstones.get(id);}
  async search(user,filters,q) { return (await this.query({type:'document',...filters,...(user.role==='student'?{status:'approved'}:{})})).filter(d=>(user.role==='admin'||d.status==='approved'||(user.role==='faculty'&&d.owner===user._id))&&(!q||[d.title,d.subject,d.description].some(v=>String(v||'').toLowerCase().includes(q.toLowerCase())))); }
}
export class CouchStore {
  constructor() { this.url=process.env.COUCHDB_URL; this.db=process.env.COUCHDB_DB||'colledocs'; if(!/^https?:\/\//.test(this.url||'') || !/^[a-z][a-z0-9_-]*$/.test(this.db)) throw new Error('Invalid CouchDB configuration'); this.auth='Basic '+Buffer.from(`${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASSWORD}`).toString('base64'); }
  async request(path, method='GET', body, binary=false) { const r=await fetch(`${this.url}/${path}`,{method,headers:{Authorization:this.auth,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)}); if(!r.ok) throw Object.assign(new Error(r.status===409?'Record changed. Refresh and retry.':r.status===404?'Record not found':'Database request failed'),{status:r.status}); return binary?Buffer.from(await r.arrayBuffer()):r.json(); }
  async init() {
    try { await this.request(this.db,'PUT'); } catch(e) { if(e.status!==412) throw e; }
    await this.request(`${this.db}/_security`,'PUT',{admins:{names:[process.env.COUCHDB_USER],roles:[]},members:{names:[process.env.COUCHDB_USER],roles:[]}});
    const id='_design/catalog'; let rev; try { rev=(await this.get(id))._rev; } catch(e) { if(e.status!==404) throw e; }
    const views={}; for(const field of ['department','category','semester','owner','groupId']) views['by_'+field]={map:`function(doc){if(doc.type==='document')emit(doc.${field},null);}`};
    await this.put({_id:id,...(rev?{_rev:rev}:{}),views});
    for(const fields of [['type'],['type','email'],['type','status'],['type','status','department','category','semester'],['type','studentKey'],['type','category']]) await this.request(`${this.db}/_index`,'POST',{index:{fields},type:'json'});
  }
  get(id) { return this.request(`${this.db}/${encodeURIComponent(id)}`); }
  async deletedRevision(id) {const r=await this.request(`${this.db}/_all_docs`,'POST',{keys:[id]});const row=r.rows[0];return row?.value?.deleted?row.value.rev:undefined;}
  async put(d) { const r=await this.request(`${this.db}/${encodeURIComponent(d._id)}`,'PUT',d); return {...d,_rev:r.rev}; }
  async query(filters={}) {
    const field=Object.keys(filters).find(k=>['department','category','semester','owner','groupId'].includes(k));
    if(filters.type==='document' && field) { const r=await this.request(`${this.db}/_design/catalog/_view/by_${field}?include_docs=true&key=${encodeURIComponent(JSON.stringify(filters[field]))}`); return r.rows.map(r=>r.doc).filter(d=>Object.entries(filters).every(([k,v])=>d[k]===v)); }
    let docs=[],bookmark; do { const r=await this.request(`${this.db}/_find`,'POST',{selector:filters,limit:200,...(bookmark?{bookmark}: {})}); docs.push(...r.docs); if(r.docs.length<200||r.bookmark===bookmark) break; bookmark=r.bookmark; } while(true); return docs;
  }
  file(d) { return this.request(`${this.db}/${encodeURIComponent(d._id)}/file`,'GET',undefined,true); }
  remove(d) {return this.request(`${this.db}/${encodeURIComponent(d._id)}?rev=${encodeURIComponent(d._rev)}`,'DELETE');}
  async search(user,filters,q) {
    const selector=searchSelector(user,filters,q);let docs=[],bookmark;
    do { const r=await this.request(`${this.db}/_find`,'POST',{selector,limit:200,...(bookmark?{bookmark}:{})});docs.push(...r.docs);if(r.docs.length<200||r.bookmark===bookmark)break;bookmark=r.bookmark; } while(true);
    return docs;
  }
}
