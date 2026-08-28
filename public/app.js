const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const fields=['job_no','customer_name','job_date','customer_no','po_number','vendor_name','bl_number','container_number','vessel','pol','pod','currency','exchange_rate','notes'];
const money=n=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(Number(n||0));
function addCharge(c={}){const tr=document.createElement('tr');tr.innerHTML=`<td><input class="item_no" value="${c.item_no||''}" placeholder="SRV-001"></td><td><input class="description" value="${c.description||''}" placeholder="Ocean Freight"></td><td><input class="qty" type="number" value="${c.qty||1}" step="0.01"></td><td><input class="unit" value="${c.unit||'JOB'}"></td><td><input class="unit_price" type="number" value="${c.unit_price||0}" step="0.01"></td><td><button type="button" class="trash">✕</button></td>`;$('#chargeTable tbody').appendChild(tr);tr.querySelector('.trash').onclick=()=>{tr.remove();renderPreview()};tr.querySelectorAll('input').forEach(i=>i.oninput=renderPreview);renderPreview()}
function charges(){return $$('#chargeTable tbody tr').map(tr=>({item_no:tr.querySelector('.item_no').value,description:tr.querySelector('.description').value,qty:+tr.querySelector('.qty').value||0,unit:tr.querySelector('.unit').value,unit_price:+tr.querySelector('.unit_price').value||0}))}
function payload(){const p={};fields.forEach(f=>p[f]=$('#'+f).value);p.charges=charges();return p}
function renderPreview(){const p=payload(), total=p.charges.reduce((s,c)=>s+c.qty*c.unit_price,0);$('#grandTotal').textContent=`${p.currency} ${money(total)}`;$('#previewTotal').textContent=`${p.currency} ${money(total)}`;$('#preview').innerHTML=`<dt>Customer</dt><dd>${p.customer_name||'-'}</dd><dt>SO Date</dt><dd>${p.job_date||'-'}</dd><dt>PO Number</dt><dd>${p.po_number||'-'}</dd><dt>BL / Container</dt><dd>${p.bl_number||'-'} / ${p.container_number||'-'}</dd><dt>Route</dt><dd>${p.pol||'-'} → ${p.pod||'-'}</dd><dt>Currency</dt><dd>${p.currency}</dd>`;$('#previewCharges').innerHTML=p.charges.map(c=>`<div class="preview-line"><span>${c.description||'(charge)'}</span><b>${money(c.qty*c.unit_price)}</b></div>`).join('')}
async function api(url,opt={}){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opt});const d=await r.json();if(!r.ok)throw new Error(d.error||'Request gagal');return d}
async function save(){const id=$('#jobId').value;const p=payload();const d=await api(id?`/api/jobs/${id}`:'/api/jobs',{method:id?'PUT':'POST',body:JSON.stringify(p)});$('#jobId').value=d.id;setMsg(`Job ${d.job_no} tersimpan.`,'ok');await refresh();return d}
async function sync(){try{const d=await save();$('#previewStatus').className='status draft';$('#previewStatus').textContent='SYNCING';const s=await api(`/api/jobs/${d.id}/sync`,{method:'POST',body:'{}'});$('#previewStatus').className='status synced';$('#previewStatus').textContent='SYNCED';setMsg(`Berhasil sync ke Accurate${s.accurate_so_no?`: ${s.accurate_so_no}`:''}.`,'ok');await refresh()}catch(e){$('#previewStatus').className='status failed';$('#previewStatus').textContent='FAILED';setMsg(e.message,'err');await refresh()}}
function setMsg(t,c){const m=$('#message');m.textContent=t;m.className='message '+c}
async function refresh(){const d=await api('/api/dashboard');$('#stTotal').textContent=d.total;$('#stReady').textContent=d.ready;$('#stSynced').textContent=d.synced;$('#stFailed').textContent=d.failed;const jobs=await api('/api/jobs');$('#jobsBody').innerHTML=jobs.map(j=>`<tr><td>${j.job_no}</td><td>${j.customer_name}</td><td>${j.bl_number||'-'}</td><td>${j.container_number||'-'}</td><td>${j.currency} ${money(j.total_amount)}</td><td><span class="badge ${j.status}">${j.status}</span></td><td>${j.accurate_so_no||'-'}</td><td><button class="linkbtn" onclick="editJob(${j.id})">Edit</button></td></tr>`).join('');const logs=await api('/api/logs');$('#logsBody').innerHTML=logs.map(l=>`<tr><td>${l.created_at}</td><td>${l.job_no||'-'}</td><td>${l.action}</td><td><span class="badge ${l.status}">${l.status}</span></td><td>${l.message||''}</td></tr>`).join('')}
window.editJob=async id=>{const j=await api(`/api/jobs/${id}`);$('#jobId').value=j.id;fields.forEach(f=>$('#'+f).value=j[f]??'');$('#chargeTable tbody').innerHTML='';j.charges.forEach(addCharge);$('#previewStatus').textContent=j.status;$('#previewStatus').className='status '+(j.status==='SYNCED'?'synced':j.status==='FAILED'?'failed':'draft');show('form');renderPreview()}
function show(v){$$('.view').forEach(e=>e.classList.add('hidden'));$('#view-'+v).classList.remove('hidden');$$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===v))}
$$('.nav').forEach(n=>n.onclick=()=>show(n.dataset.view));fields.forEach(f=>$('#'+f).addEventListener('input',renderPreview));$('#addCharge').onclick=()=>addCharge();$('#jobForm').onsubmit=async e=>{e.preventDefault();try{await save()}catch(err){setMsg(err.message,'err')}};$('#syncBtn').onclick=sync;
$('#job_date').value=new Date().toISOString().slice(0,10);addCharge({description:'Ocean Freight',qty:1,unit:'BL'});addCharge({description:'Documentation Fee',qty:1,unit:'JOB'});refresh();renderPreview();

async function refreshAccurateStatus(){
  try{
    const s=await api('/api/accurate/status');
    const state=$('#accurateState'), connect=$('#connectAccurate'), disconnect=$('#disconnectAccurate');
    if(s.connected){
      state.textContent=`● Accurate connected${s.user?.name?` — ${s.user.name}`:''}`;
      state.className='pill connected';
      connect.textContent='Reconnect Accurate';
      disconnect.classList.remove('hidden');
    }else{
      state.textContent='● Accurate disconnected';
      state.className='pill disconnected';
      connect.textContent='Connect Accurate';
      disconnect.classList.add('hidden');
    }
  }catch(e){ console.error(e); }
}
$('#disconnectAccurate').onclick=async()=>{try{await api('/api/accurate/disconnect',{method:'POST',body:'{}'});await refreshAccurateStatus();setMsg('Koneksi Accurate diputus.','ok')}catch(e){setMsg(e.message,'err')}};
const oauthParams=new URLSearchParams(location.search);
if(oauthParams.get('accurate')==='connected'){setMsg('Accurate Online berhasil terhubung via OAuth.','ok');history.replaceState({},'',location.pathname)}
if(oauthParams.get('accurate')==='error'){setMsg(oauthParams.get('message')||'OAuth Accurate gagal.','err');history.replaceState({},'',location.pathname)}
refreshAccurateStatus();
