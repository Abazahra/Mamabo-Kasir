import {all,put,remove,bulkPut,clearAndSeed,uid,discardVerifiedDemoRecords,cleanupDemoCatalog} from './db.js?v=demo-cleanup-1';
import {createUser,login,can,roleName} from './auth.js?v=operational-normalization-2';
import {mountPOS,mountShift,mountTransactionHistory} from './pos.js?v=shared-drawer-7';
import {mountPurchasing} from './purchasing.js?v=operational-normalization-2';
import {mountDashboard,mountReports,mountAudit,mountSettings,audit} from './stage4.js?v=shared-drawer-6';
import {startCloudSync,cloudStatus,syncNow,cloudSignInOwner,cloudRegisterOwner,cloudUpdateOwnerProfile} from './cloud-sync.js?v=catalog-diagnostic-2';
import {devicePaired,syncDeviceCatalog,loginDeviceStaffAuto,restoreDeviceStaffSession,logoutDeviceStaff,startDeviceDataSync,reconcileDeviceCatalogQueue,updateDeviceStaffProfile} from './device-pairing.js?v=demo-cleanup-1';
import {mountStaffAccounts} from './staff-accounts.js?v=owner-job-invites-1';
import {mountExpenses} from './expenses.js?v=shared-drawer-6';
const $=s=>document.querySelector(s), htmlSafe=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c])), money=n=>'Rp '+Number(n||0).toLocaleString('id-ID'), date=()=>new Date().toLocaleString('id-ID',{timeZone:'Asia/Jakarta'}), fmt=n=>Number(n||0).toLocaleString('id-ID');
let user=null,page='dashboard',products=[],categories=[],customers=[],suppliers=[],movements=[];
const LOCAL_SESSION_KEY='mambo_local_session_user';
function acceptOwnerLogin(detail){
 if(!detail?.owner)return;
 user=detail.owner;
 localStorage.setItem(LOCAL_SESSION_KEY,user.id);
 localStorage.setItem('mambo_owner_cloud_session',JSON.stringify(user));
 page='dashboard';
 $('#login').classList.add('hidden');
 shell();
 toast('Owner berhasil masuk. '+Number(detail.pulled||0)+' data cloud diperiksa; '+Number(detail.applied||0)+' data diterapkan.');
}
window.addEventListener('mambo-owner-login-success',event=>acceptOwnerLogin(event.detail));
if(window.__mamboOwnerLoginPending){
 const pending=window.__mamboOwnerLoginPending;
 delete window.__mamboOwnerLoginPending;
 acceptOwnerLogin(pending);
}

function toast(s){const t=$('#toast');t.textContent=s;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500)}
const QUEUE_LABELS={products:'Produk',categories:'Kategori',customers:'Pelanggan',suppliers:'Supplier',movements:'Kartu Stok',transactions:'Transaksi',shifts:'Shift & Laci Kas',auditLogs:'Audit Log',opnames:'Stock Opname',settings:'Pengaturan',receivables:'Piutang',promos:'Promosi',returns:'Retur',purchases:'Pembelian',payables:'Utang',supplierPayments:'Pembayaran Supplier',operationalExpenses:'Biaya Operasional'};
function queueItemDescription(item){
 const p=item.payload||{};
 const parts=[];
 for(const key of ['transactionNo','invoiceNo','receiptNo','name','sku','username','date','time','status','total','amount','type','note']){
  const value=p[key];
  if(value!==undefined&&value!==null&&String(value).trim()!=='')parts.push(key+': '+String(value).slice(0,90));
 }
 return parts.join(' · ')||'Detail record tidak tersedia pada antrean ini';
}

async function cleanupDemoProductsR17(){
 const pattern=/^BRG-(00[1-9]|01[0-5])$/;
 const products=(await all('products')).filter(p=>pattern.test(String(p.sku||'')));
 const productIds=new Set(products.map(p=>String(p.id)));
 const queue=await all('syncQueue');
 const productQueue=queue.filter(q=>q.entity==='products'&&productIds.has(String(q.recordId)));
 const categories=await all('categories');
 const usedByDemo=new Set(products.map(p=>String(p.categoryId||'')).filter(Boolean));
 const otherProducts=(await all('products')).filter(p=>!productIds.has(String(p.id)));
 const categoryQueue=queue.filter(q=>q.entity==='categories');
 const categoriesToRemove=categories.filter(c=>usedByDemo.has(String(c.id))&&!otherProducts.some(p=>String(p.categoryId||'')===String(c.id))&&categoryQueue.some(q=>String(q.recordId)===String(c.id)));
 const categoryQueueRows=categoryQueue.filter(q=>categoriesToRemove.some(c=>String(c.id)===String(q.recordId)));
 if(products.length!==15||productQueue.length!==15||productQueue.some(q=>q.operation!=='upsert')||categoriesToRemove.some(c=>categoryQueueRows.filter(q=>String(q.recordId)===String(c.id)).length!==1)) {
  const error='Pembersihan otomatis dibatalkan: ditemukan '+products.length+' produk demo, '+productQueue.length+' antrean produk, dan '+categoriesToRemove.length+' kategori yang memenuhi syarat. Jumlah/antrean harus diverifikasi dahulu.';
  throw Error(error);
 }
 const backup={app:'MAMBO KASIR',type:'backup-demo-cleanup',createdAt:new Date().toISOString(),device:JSON.parse(localStorage.getItem('mambo_paired_device')||'null')?.deviceId||'unknown',products,categories:categoriesToRemove,queue:[...productQueue,...categoryQueueRows]};
 const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='MAMBO-R17-backup-demo-BRG-001-015-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 if(!confirm('Backup JSON sudah diminta untuk diunduh. Pastikan file backup tersimpan di HP. Lanjutkan menghapus tepat 15 produk demo BRG-001–BRG-015, kategori yang hanya dipakai produk demo, dan antrean terkait? Transaksi, Shift, stok lain, dan produk lain tidak disentuh.'))return {cancelled:true};
 const result=await cleanupDemoCatalog(products.map(p=>({id:p.id,sku:p.sku})),categoriesToRemove.map(c=>({id:c.id,name:c.name})));
 const remain=(await all('products')).filter(p=>pattern.test(String(p.sku||''))).length;
 const qRemain=(await all('syncQueue')).filter(q=>(q.entity==='products'&&pattern.test(String(q.payload?.sku||''))));
 if(remain||qRemain.length)throw Error('Sebagian data demo masih tersisa: produk '+remain+', antrean '+qRemain.length+'. Jangan ulangi; kirim hasil ini untuk pemeriksaan.');
 return {...result,remainingProducts:remain,remainingQueue:qRemain.length};
}

async function inspectLocalSyncQueue(){
 const button=$('#inspectSyncQueueBtn');
 if(button){button.disabled=true;button.textContent='Memeriksa database lokal…';}
 try{
  const queue=(await all('syncQueue')).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  const groups=new Map();
  for(const item of queue){
   const key=item.entity||'unknown';
   if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push(item);
  }
  const rows=[...groups.entries()].sort((a,b)=>b[1].length-a[1].length).map(([entity,items])=>{
   const oldest=items[0]?.createdAt?new Date(items[0].createdAt).toLocaleString('id-ID'):'-';
   const newest=items[items.length-1]?.createdAt?new Date(items[items.length-1].createdAt).toLocaleString('id-ID'):'-';
   return '<tr><td>'+htmlSafe(QUEUE_LABELS[entity]||entity)+'</td><td>'+items.length+'</td><td>'+items.filter(x=>x.operation==='delete').length+'</td><td>'+items.filter(x=>x.operation!=='delete').length+'</td><td>'+htmlSafe(oldest)+'</td><td>'+htmlSafe(newest)+'</td></tr>';
  }).join('');
  const detail=queue.slice(0,250).map(item=>'<tr><td>'+htmlSafe(QUEUE_LABELS[item.entity]||item.entity||'Tidak diketahui')+'</td><td>'+htmlSafe(item.operation||'upsert')+'</td><td><code>'+htmlSafe(item.recordId||'-')+'</code></td><td>'+htmlSafe(item.createdAt?new Date(item.createdAt).toLocaleString('id-ID'):'-')+'</td><td>'+htmlSafe(queueItemDescription(item))+'</td></tr>').join('');
  const wrap=document.createElement('div');wrap.className='modal-backdrop';
  wrap.innerHTML='<section class="modal queue-inspector"><h2>Pemeriksaan Antrean Lokal</h2><p class="muted">Pemeriksaan hanya membaca IndexedDB pada perangkat ini. Tidak ada record yang dikirim, diubah, atau dihapus.</p><h3>Total antrean: '+queue.length+' perubahan</h3>'+(queue.length?'<div class="table-wrap"><table><thead><tr><th>Jenis Data</th><th>Total</th><th>Hapus</th><th>Simpan/Ubah</th><th>Tertua</th><th>Terbaru</th></tr></thead><tbody>'+rows+'</tbody></table></div><h3 style="margin-top:20px">Rincian antrean (maksimal 250 item tertua)</h3><div class="table-wrap"><table><thead><tr><th>Data</th><th>Aksi</th><th>Record ID</th><th>Waktu</th><th>Ringkasan</th></tr></thead><tbody>'+detail+'</tbody></table></div>'+(queue.length>250?'<p class="muted">Masih ada '+(queue.length-250)+' item lain; belum ditampilkan pada rincian.</p>':''):'<p class="empty">Tidak ada antrean lokal. Tidak ada perubahan tertunda.</p>')+'<p class="muted">Catatan: antrean Shift ditampilkan apa adanya. Jangan menghapus antrean secara manual sebelum isi dan statusnya diverifikasi.</p><div class="modal-actions"><button class="secondary" id="reconcileCatalogQueue">Cocokkan Katalog dengan Cloud</button><button class="secondary" id="cleanupDemoR17">Backup & Bersihkan Produk Demo BRG-001–015</button><button class="secondary" id="refreshQueueReport">Perbarui</button><button class="primary" id="closeQueueReport">Tutup</button></div></section>';
  document.body.append(wrap);
  wrap.querySelector('#closeQueueReport').onclick=()=>wrap.remove();
  wrap.querySelector('#cleanupDemoR17').onclick=async()=>{
   const btn=wrap.querySelector('#cleanupDemoR17');btn.disabled=true;btn.textContent='Memeriksa data demo…';
   try{
    const result=await cleanupDemoProductsR17();
    if(result.cancelled){btn.disabled=false;btn.textContent='Backup & Bersihkan Produk Demo BRG-001–015';return;}
    wrap.remove();
    alert('Pembersihan selesai. Produk dihapus: '+result.productsRemoved+'. Kategori demo yang tidak dipakai produk lain: '+result.categoriesRemoved+'. Antrean terkait dibersihkan: '+result.queueRemoved+'. Sisa produk demo: '+result.remainingProducts+'. Sisa antrean demo: '+result.remainingQueue+'.');
    inspectLocalSyncQueue();
   }catch(error){btn.disabled=false;btn.textContent='Backup & Bersihkan Produk Demo BRG-001–015';alert('Pembersihan dibatalkan atau gagal: '+(error.message||error));}
  };
  wrap.querySelector('#refreshQueueReport').onclick=()=>{wrap.remove();inspectLocalSyncQueue();};
  wrap.querySelector('#reconcileCatalogQueue').onclick=async()=>{
   const action=wrap.querySelector('#reconcileCatalogQueue');
   action.disabled=true;action.textContent='Membandingkan dengan Cloud…';
   try{
    const result=await reconcileDeviceCatalogQueue();
    wrap.remove();
    const detailRows=(result.details||[]).map(item=>{
    const local=item.entity==='products'
     ?['SKU: '+(item.localSku||'-'),'Nama: '+(item.localName||'-'),'Barcode: '+(item.localBarcode||'-'),'Harga: '+(item.localPrice||'-'),'Kategori ID: '+(item.localCategoryId||'-')].join(' | ')
     :'Nama kategori: '+(item.localName||'-');
    const candidates=(item.candidates||[]).map(x=>(x.sku?x.sku+' — ':'')+(x.name||'')+' ['+x.id+']').join('; ');
    return '<article class="reconcile-item"><div class="reconcile-item-head"><strong>'+htmlSafe(QUEUE_LABELS[item.entity]||item.entity)+'</strong><span class="'+(item.safe?'success':'error')+'">'+(item.safe?'Cocok':'Perlu pemeriksaan')+'</span></div><div class="reconcile-field"><small>Record ID lokal</small><code>'+htmlSafe(item.recordId)+'</code></div><div class="reconcile-field"><small>Identitas lokal</small><span>'+htmlSafe(local)+'</span></div><div class="reconcile-field"><small>Kandidat di Cloud</small><span>'+htmlSafe(candidates||'Tidak ditemukan')+'</span></div><div class="reconcile-field"><small>Alasan</small><span>'+htmlSafe(item.reason||'-')+'</span></div></article>';
   }).join('');
    const report=document.createElement('div');report.className='modal-backdrop';
    report.innerHTML='<section class="modal queue-inspector"><h2>Hasil Rekonsiliasi Katalog</h2><p class="muted">Hanya antrean yang terbukti cocok yang dilepas. Data katalog dan transaksi tidak diubah.</p><h3>'+result.removed+' antrean cocok diamankan</h3><p>Masih tertunda: '+result.catalogRemaining+' antrean katalog. Tidak ditemukan: '+result.missing+'. Berbeda: '+result.different+'.</p><div class="reconcile-list">'+detailRows+'</div><p class="muted">Record yang berbeda atau tidak ditemukan tetap berada di antrean lokal.</p><div class="modal-actions"><button class="secondary" id="refreshAfterReconcile">Perbarui antrean</button><button class="primary" id="closeReconcileReport">Tutup</button></div></section>';
    document.body.append(report);
    report.querySelector('#closeReconcileReport').onclick=()=>report.remove();
    report.querySelector('#refreshAfterReconcile').onclick=()=>{report.remove();inspectLocalSyncQueue();};
    toast('Rekonsiliasi: '+result.removed+' cocok; '+result.catalogRemaining+' masih tertunda.');
   }catch(error){
    action.disabled=false;action.textContent='Cocokkan Katalog dengan Cloud';
    const note=document.createElement('p');note.className='error';note.textContent='Rekonsiliasi dibatalkan tanpa mengubah antrean: '+(error.message||error);
    action.parentElement.before(note);
   }
  };
 }catch(error){
  const box=$('#ownerCloudLoginError');if(box)box.textContent='Pemeriksaan antrean gagal: '+(error.message||error);
 }finally{
  if(button){button.disabled=false;button.textContent='Periksa Antrean Lokal (aman)';}
 }
}
document.addEventListener('click',event=>{if(event.target.closest('#inspectSyncQueueBtn'))inspectLocalSyncQueue();});
window.addEventListener('mambo-device-sync',event=>{
 const el=$('#syncStatus'),detail=event.detail||{};
 if(!el||!devicePaired())return;
 el.dataset.state=detail.ok?'online':'offline';
 el.textContent=detail.ok?'Online':'Offline';
 el.title=detail.ok
  ?'Sinkronisasi perangkat kasir berhasil. Data terbaru diterima dari server.'
  :'Sinkronisasi perangkat kasir gagal: '+(detail.error||'Penyebab belum diketahui.');
});
function eanValid(v){if(!v)return true;if(!/^\d{13}$/.test(v))return false;let sum=0;for(let i=0;i<12;i++)sum+=Number(v[i])*(i%2?3:1);return (10-sum%10)%10===Number(v[12]);}
async function refresh(){[products,categories,customers,suppliers,movements]=await Promise.all(['products','categories','customers','suppliers','movements'].map(all));}
async function seed(){if((await all('users')).length){toast('Data sudah tersedia.');return;}await clearAndSeed();const cats=['Sembako','Makanan','Minuman','Perawatan','Rumah Tangga'].map(name=>({id:uid(),name}));await bulkPut('categories',cats);await bulkPut('customers',[{id:uid(),name:'Pelanggan Umum',phone:'-'},{id:uid(),name:'Bu Siti',phone:'081234567890'},{id:uid(),name:'Pak Andi',phone:'081298765432'}]);await bulkPut('suppliers',[{id:uid(),name:'CV Sumber Makmur',phone:'081300001111'},{id:uid(),name:'PT Niaga Jaya',phone:'081300002222'}]);await createUser('Pemilik Toko','owner','123456');await createUser('Supervisor','supervisor','2222');await createUser('Kasir 1','cashier','1111');await refresh();toast('Data demo berhasil dibuat.');}
function shell(){ $('#login').classList.add('hidden');$('#app').classList.remove('hidden');$('#who').innerHTML=`<b>${user.name}</b><br><span class="muted">${(user.jobTitle||roleName(user.role))}</span>`;$('#nav').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));$('#nav').querySelectorAll('button').forEach(b=>b.classList.toggle('hidden',!can(user,b.dataset.page)));render();}
function heading(title,sub,action=''){return `<h1>${title}</h1><p class="sub">${sub}</p>${action}`}
async function render(){await refresh();$('#pageTitle').textContent=({dashboard:'Dashboard Eksekutif',reports:'Laporan',audit:'Audit Log',settings:'Pengaturan & Backup',staff:'Akun Karyawan',expenses:'Biaya Operasional',pos:'Mesin Kasir',transactions:'Riwayat Transaksi',shift:'Shift & Laci Kas',purchasing:'Pembelian & Utang',products:'Produk & Inventaris',stock:'Kartu Stok',opname:'Stock Opname',contacts:'Pelanggan & Supplier',settings:'Pengaturan'})[page]||page;const c=$('#content');if(page==='dashboard')await mountDashboard(c,user);else if(page==='reports')await mountReports(c,user);else if(page==='audit')await mountAudit(c,user);else if(page==='settings')await mountSettings(c,user);else if(page==='staff')await mountStaffAccounts(c,user);
else if(page==='pos')await mountPOS(c,user);else if(page==='transactions')await mountTransactionHistory(c,user);else if(page==='shift')await mountShift(c,user);else if(page==='expenses')await mountExpenses(c,user);else if(page==='purchasing')await mountPurchasing(c,user);else if(page==='products')renderProducts(c);else if(page==='stock')c.innerHTML=heading('Kartu Stok','Riwayat setiap perubahan jumlah persediaan.')+`<section class="panel">${table(movements.slice().reverse(),['Waktu','Produk','Jenis','Perubahan','Catatan'],m=>`<td>${m.time}</td><td>${m.productName}</td><td>${m.type}</td><td>${m.delta>0?'+':''}${m.delta}</td><td>${m.note||'-'}</td>`)}</section>`;else if(page==='opname')renderOpname(c);else if(page==='contacts')renderContacts(c);else if(page==='settings')c.innerHTML=heading('Pengaturan','Pengelolaan data lokal dan preferensi aplikasi.')+`<section class="panel"><h3>Database lokal</h3><p class="muted">Data tersimpan di browser/perangkat ini menggunakan IndexedDB. Hapus data browser dapat menghilangkan data jika belum diekspor.</p><div class="actions"><button class="primary" id="seedBtn">Isi Data Demo</button><button class="secondary" id="exportBtn">Ekspor Produk CSV</button><label class="secondary">Impor Produk CSV <input id="importCsv" type="file" accept=".csv,text/csv" hidden></label></div><p class="muted">Mode: Offline-First · Zona waktu: WIB · Tema dapat diganti melalui tombol ◐.</p></section>`;bindCommon();}

window.addEventListener('mambo-cloud-pulled',async e=>{
 if(!user||document.querySelector('.modal-backdrop'))return;
 const active=document.activeElement,content=$('#content');
 if(active&&content&&content.contains(active))return;
 await render();
 if(e.detail?.applied)toast('Data cloud diperbarui: '+e.detail.applied+' record.');
});

function table(rows,heads,renderRow){if(!rows.length)return '<div class="empty">Belum ada data.</div>';return `<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(x=>`<tr>${renderRow(x)}</tr>`).join('')}</tbody></table></div>`}
function renderProducts(c){c.innerHTML=heading('Produk & Inventaris','Kelola katalog, harga, satuan, dan persediaan.',`<div class="actions"><button class="primary" id="addProduct">＋ Tambah Produk</button><button class="secondary" id="manageCategories">Kelola Kategori</button><button class="secondary" id="exportCsv">Ekspor CSV</button><label class="secondary">Impor CSV <input id="importCsv" type="file" accept=".csv,text/csv" hidden></label>${user.role==='owner'?'<button class="danger" id="cleanupDemoProducts">Bersihkan 23 Data Uji</button>':''}</div>`)+`<section class="panel"><div class="toolbar"><input id="searchProduct" placeholder="Cari nama, SKU, barcode..."><select id="categoryFilter"><option value="">Semua kategori</option>${categories.map(x=>`<option value="${x.id}">${x.name}</option>`).join('')}</select></div><div id="productTable"></div></section>`;const draw=()=>{const q=$('#searchProduct').value.toLowerCase(),cat=$('#categoryFilter').value;const rows=products.filter(p=>(!cat||p.categoryId===cat)&&[p.name,p.sku,p.barcode].join(' ').toLowerCase().includes(q));$('#productTable').innerHTML=table(rows,['Foto','SKU','Nama Produk','Kategori','Stok','Harga Jual','HPP','Aksi'],p=>`<td>${p.photo?`<img src="${URL.createObjectURL(new Blob([p.photo],{type:p.photoType||'image/jpeg'}))}" alt="" style="width:42px;height:42px;object-fit:cover;border-radius:7px">`:'—'}</td><td>${p.sku}</td><td><b>${p.name}</b><br><small class="muted">${p.shelf||'-'}</small></td><td>${categories.find(x=>x.id===p.categoryId)?.name||'-'}</td><td>${fmt(p.stock)} ${p.baseUnit||''}</td><td>${money(p.price)}</td><td>${user.role==='owner'?money(p.cost):'••••••'}</td><td><button class="secondary" data-edit="${p.id}">Edit</button> <button class="danger" data-delete="${p.id}">Hapus</button> <button class="ghost" data-label="${p.id}">Label</button></td>`);};draw();$('#searchProduct').oninput=draw;$('#categoryFilter').onchange=draw;$('#addProduct').onclick=()=>productModal();$('#manageCategories').onclick=manageCategories;$('#productTable').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.edit)productModal(products.find(p=>p.id===b.dataset.edit));if(b.dataset.delete)deleteProduct(b.dataset.delete);if(b.dataset.label)printLabel(products.find(p=>p.id===b.dataset.label));};$('#exportCsv').onclick=exportCSV;$('#importCsv').onchange=importCSV;$('#cleanupDemoProducts')?.addEventListener('click',cleanupDemoProducts);}
function manageCategories(){
 const wrap=document.createElement('div');wrap.className='modal-backdrop';
 wrap.innerHTML='<section class="modal"><h2>Kelola Kategori</h2><p class="muted">Tambah atau ubah kategori produk. Kategori yang sudah dipakai produk tidak dapat dihapus.</p><div class="field"><label>Nama kategori baru</label><input id="newCategoryName" placeholder="Contoh: Es Mambo"></div><div class="modal-actions" style="justify-content:flex-start"><button class="primary" id="addCategoryBtn">Tambah Kategori</button></div><div id="categoryManagerList" style="margin-top:14px"></div><div class="modal-actions"><button class="secondary" id="closeCategoryManager">Tutup</button></div><p id="categoryManagerError" class="error"></p></section>';
 document.body.append(wrap);
 const escHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const draw=()=>{wrap.querySelector('#categoryManagerList').innerHTML=categories.length?'<div class="table-wrap"><table><thead><tr><th>Nama Kategori</th><th>Jumlah Produk</th><th>Aksi</th></tr></thead><tbody>'+categories.map(cat=>{const used=products.filter(p=>p.categoryId===cat.id).length;return '<tr><td>'+escHtml(cat.name)+'</td><td>'+used+'</td><td><button class="secondary" data-edit-category="'+cat.id+'">Edit</button> <button class="danger" data-delete-category="'+cat.id+'" '+(used?'disabled title="Kategori sedang digunakan"':'')+'>Hapus</button></td></tr>';}).join('')+'</tbody></table></div>':'<div class="empty">Belum ada kategori.</div>';};
 const error=msg=>{wrap.querySelector('#categoryManagerError').textContent=msg||'';};
 draw();
 wrap.querySelector('#closeCategoryManager').onclick=()=>{wrap.remove();render();};
 wrap.querySelector('#addCategoryBtn').onclick=async()=>{const input=wrap.querySelector('#newCategoryName'),name=input.value.trim();if(!name)return error('Nama kategori wajib diisi.');if(categories.some(c=>c.name.trim().toLowerCase()===name.toLowerCase()))return error('Kategori tersebut sudah ada.');const cat={id:uid(),name};await put('categories',cat);await refresh();input.value='';error('');draw();toast('Kategori berhasil ditambahkan.');};
 wrap.querySelector('#categoryManagerList').onclick=async e=>{const b=e.target.closest('button');if(!b)return;const cat=categories.find(c=>c.id===(b.dataset.editCategory||b.dataset.deleteCategory));if(!cat)return;const used=products.some(p=>p.categoryId===cat.id);if(b.dataset.editCategory){const name=prompt('Ubah nama kategori:',cat.name);if(name===null)return;const next=name.trim();if(!next)return error('Nama kategori tidak boleh kosong.');if(categories.some(c=>c.id!==cat.id&&c.name.trim().toLowerCase()===next.toLowerCase()))return error('Nama kategori tersebut sudah ada.');await put('categories',{...cat,name:next});await refresh();error('');draw();toast('Nama kategori diperbarui.');}else if(b.dataset.deleteCategory){if(used)return error('Kategori masih digunakan oleh produk dan tidak dapat dihapus.');if(!confirm('Hapus kategori "'+cat.name+'"?'))return;await remove('categories',cat.id);await refresh();error('');draw();toast('Kategori dihapus.');}};
}
function productModal(p){const edit=!!p;const f=(id,label,val='',type='text',extra='')=>`<div class="field"><label>${label}</label><input id="${id}" type="${type}" value="${String(val??'').replaceAll('"','&quot;')}" ${extra}></div>`;const catOptions=categories.map(x=>`<option value="${x.id}" ${p?.categoryId===x.id?'selected':''}>${x.name}</option>`).join('');modal(`${edit?'Edit':'Tambah'} Produk`,`<div class="form-grid">${f('sku','Kode SKU',p?.sku||'')}${f('barcode','Barcode EAN-13',p?.barcode||'','text','inputmode="numeric" maxlength="13"')}${f('name','Nama Produk',p?.name||'')}<div class="field"><label>Kategori</label><select id="categoryId">${catOptions}</select></div>${f('shelf','Lokasi Rak',p?.shelf||'')}${user.role==='owner'?f('cost','Harga Modal / HPP',p?.cost||0,'number','min="0"'):'<div class="field"><label>Harga Modal / HPP</label><input value="••••••" disabled></div>'}${f('price','Harga Jual Eceran',p?.price||0,'number','min="0"')}${f('minStock','Batas Stok Minimum',p?.minStock||0,'number','min="0"')}${f('stock','Stok Awal / Stok Saat Ini',p?.stock||0,'number','min="0"')}${f('baseUnit','Satuan Dasar',p?.baseUnit||'Pcs')}${f('expiry','Tanggal Kedaluwarsa',p?.expiry||'','date')}<div class="field wide"><label>Foto Produk (opsional)</label><input id="photo" type="file" accept="image/*"></div><div class="field wide"><label>Satuan bertingkat (format: Nama:Konversi, pisahkan koma)</label><input id="units" value="${(p?.units||[{name:'Pcs',factor:1}]).filter(u=>u.factor!==1).map(u=>`${u.name}:${u.factor}`).join(', ')}" placeholder="Dus:24, Pack:6"></div><div class="field wide"><label>Harga grosir (format: Minimal beli=harga per satuan dasar; pisahkan koma)</label><input id="wholesale" value="${(p?.wholesale||[]).map(w=>`${w.min}=${w.price}`).join(', ')}" placeholder="12=3200, 24=3000"></div><div class="field wide"><label>Komponen bundling (format: SKU:jumlah; pisahkan koma)</label><input id="bundle" value="${(p?.bundle||[]).map(b=>`${b.sku}:${b.qty}`).join(', ')}" placeholder="BRG-001:1, BRG-002:2"></div></div><p class="muted">Bundling: isi komponen untuk menjadikan produk ini paket. Stok paket dihitung dari komponen, bukan stok manual.</p>`,async()=>{const val=id=>$('#'+id).value.trim(),sku=val('sku'),barcode=val('barcode');if(!sku||!val('name'))throw Error('SKU dan nama produk wajib diisi.');if(!eanValid(barcode))throw Error('Barcode harus EAN-13 valid (13 digit).');if(products.some(x=>x.sku.toLowerCase()===sku.toLowerCase()&&x.id!==p?.id))throw Error('SKU sudah digunakan.');const units=[{name:val('baseUnit')||'Pcs',factor:1,price:Number(val('price'))}];if(val('units'))for(const part of val('units').split(',')){const [name,factor]=part.split(':').map(x=>x.trim());if(!name||!(Number(factor)>1))throw Error('Format satuan tidak valid. Contoh Dus:24.');units.push({name,factor:Number(factor),price:Number(val('price'))*Number(factor)});}const wholesale=val('wholesale')?val('wholesale').split(',').map(x=>{const [min,price]=x.split('=').map(Number);if(!(min>0&&price>=0))throw Error('Format harga grosir tidak valid.');return{min,price};}):[];const bundle=val('bundle')?val('bundle').split(',').map(x=>{const [s,q]=x.split(':').map(y=>y.trim());const prod=products.find(z=>z.sku===s);if(!prod||!(Number(q)>0))throw Error(`Komponen bundling ${s} tidak ditemukan atau jumlah salah.`);return{productId:prod.id,sku:s,qty:Number(q)};}):[];let photo=p?.photo||null,photoType=p?.photoType||'image/jpeg';const file=$('#photo').files[0];if(file){if(file.size>2*1024*1024)throw Error('Foto maksimal 2 MB.');if(!file.type.startsWith('image/'))throw Error('File harus berupa gambar.');photo=await file.arrayBuffer();photoType=file.type;}const obj={...(p||{}),id:p?.id||uid(),sku,barcode,name:val('name'),categoryId:$('#categoryId').value,shelf:val('shelf'),cost:user.role==='owner'?Number(val('cost')):(p?.cost||0),price:Number(val('price')),minStock:Number(val('minStock')),stock:Number(val('stock')),baseUnit:val('baseUnit')||'Pcs',expiry:val('expiry'),photo,photoType,units,wholesale,bundle,updatedAt:date()};await put('products',obj);await refresh();toast('Produk berhasil disimpan.');render();});}
function modal(title,body,onSave){const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<section class="modal"><h2>${title}</h2>${body}<div class="modal-actions"><button class="secondary" id="cancel">Batal</button><button class="primary" id="save">Simpan</button></div><p id="modalError" class="error"></p></section>`;document.body.append(wrap);wrap.querySelector('#cancel').onclick=()=>wrap.remove();wrap.querySelector('#save').onclick=async()=>{try{await onSave();wrap.remove();}catch(e){wrap.querySelector('#modalError').textContent=e.message;}};}
async function cleanupDemoProducts(){
 if(user?.role!=='owner')return toast('Hanya Owner yang dapat membersihkan data uji.');
 if(devicePaired())return toast('Jalankan dari perangkat Owner utama, bukan perangkat kasir.');
 let cloud;try{cloud=await cloudStatus();}catch(e){return toast('Status Cloud belum dapat diperiksa: '+(e.message||e));}
 if(!cloud.authenticated)return toast('Login Cloud Owner terlebih dahulu.');
 const expected=[
 {entity:'products',recordId:'5d6e5978-0f53-4082-84d6-c0d71dd3e405',sku:'BRG-001'},
 {entity:'products',recordId:'00748fce-5b32-41df-8fc3-faaaacee2b1a',sku:'BRG-002'},
 {entity:'products',recordId:'3895ce44-ca4e-4c57-9c3d-29dd2fda440b',sku:'BRG-003'},
 {entity:'products',recordId:'6f6044c7-9d47-4756-a1a6-f1846b24bcf4',sku:'BRG-004'},
 {entity:'products',recordId:'97f76263-bdc4-4d97-9a3a-75202ce06e60',sku:'BRG-005'},
 {entity:'products',recordId:'68aeced0-a82a-43e1-98fa-83785f7214e7',sku:'BRG-006'},
 {entity:'products',recordId:'61c686db-a249-4746-80f5-aa5c31ac78ee',sku:'BRG-007'},
 {entity:'products',recordId:'1aa1a243-d66f-41bf-ba4b-361a213d2f94',sku:'BRG-008'},
 {entity:'products',recordId:'a8a30c2a-dc66-46e9-896f-68db284d73f5',sku:'BRG-009'},
 {entity:'products',recordId:'c5baff4f-2d9a-4886-a985-5d6a2d95f3a3',sku:'BRG-010'},
 {entity:'products',recordId:'3c39f9d3-8f8a-4059-99e4-3eea20f60a52',sku:'BRG-011'},
 {entity:'products',recordId:'daf76cfb-50fd-489f-a557-3354b2b0e7a9',sku:'BRG-012'},
 {entity:'products',recordId:'35e75b26-f2d5-4038-9008-261c5700f587',sku:'BRG-013'},
 {entity:'products',recordId:'bdfb54fb-cb06-45b0-9a89-f0e984e9d00f',sku:'BRG-014'},
 {entity:'products',recordId:'09814dac-d032-40bb-a9fa-4b3ef100a3da',sku:'BRG-015'}
 ,{entity:'customers',recordId:'d6541209-3366-4469-9f98-b150d7ba7056'},{entity:'customers',recordId:'a4a39950-d418-4c43-8221-d0e8ae839cef'},{entity:'customers',recordId:'c3abe7ac-7fca-4d30-8d4d-a862c398f8f4'},
 {entity:'suppliers',recordId:'33fee464-784b-4a12-94e8-f058365b8a3c'},{entity:'suppliers',recordId:'07122d62-2530-42fc-a8b2-fae6ffe78d69'},
 {entity:'auditLogs',recordId:'70907377-5593-445e-b670-7764a75f5872'},{entity:'auditLogs',recordId:'75104b57-ce86-4c7c-bfc6-9a33defa6501'},{entity:'auditLogs',recordId:'f1d14a98-f5ba-45b3-86de-543c57154baa'}
 ];
 const summary='15 produk (BRG-001 s.d. BRG-015), 3 pelanggan, 2 supplier, dan 3 audit log.\n\nHanya 23 record lokal yang persis cocok dengan laporan antrean diperiksa. Data Cloud pusat tidak dihapus; antrean upsert uji dibuang agar tidak terkirim. Transaksi, shift, stok, akun, dan pengaturan tidak disentuh.\n\nLanjutkan?';
 if(!confirm('BERSIHKAN 23 RECORD DATA UJI?\n\n'+summary))return;
 try{
  const result=await discardVerifiedDemoRecords(expected);
  await refresh();
  await audit(user,'BERSIHKAN_DATA_UJI_LOKAL','Membuang '+result.removed+' record antrean uji lokal; Cloud tidak dihapus.');
  await refresh();
  let syncMessage='Data uji lokal dibersihkan. Sinkronisasi Cloud akan memperbarui katalog pusat.';
  try{const sync=await syncNow();syncMessage=sync.ok?'Data uji lokal dibersihkan. Sinkronisasi selesai: '+sync.pushed+' dikirim, '+sync.pulled+' diterima, antrean tersisa '+sync.pending+'.':'Data uji lokal dibersihkan, tetapi sinkronisasi belum selesai: '+sync.error;}
  catch(e){syncMessage='Data uji lokal dibersihkan, tetapi sinkronisasi belum selesai: '+(e.message||e);}
  await refresh();toast(syncMessage);render();
 }catch(e){toast('Pembersihan dibatalkan: '+(e.message||e));}
}
async function deleteProduct(id){if(!confirm('Hapus produk ini? Riwayat mutasi tetap dipertahankan.'))return;await audit(user,'HAPUS_PRODUK',id);await remove('products',id);toast('Produk dihapus.');render();}
async function movement(p,type,delta,note){if(p.bundle?.length){for(const item of p.bundle){const child=products.find(x=>x.id===item.productId);if(!child)throw Error('Komponen paket tidak ditemukan.');await movement(child,type,delta*item.qty,note+` (Paket ${p.name})`);}return;}if(p.stock+delta<0)throw Error(`Stok ${p.name} tidak mencukupi.`);p.stock+=delta;await put('products',p);await audit(user,'UBAH_STOK',p.name+' '+delta+' ('+type+') '+note);await put('movements',{id:uid(),productId:p.id,productName:p.name,type,delta,note,time:date()});}
function renderOpname(c){c.innerHTML=heading('Stock Opname','Cocokkan stok sistem dengan hasil hitung fisik.')+`<section class="panel"><div class="toolbar"><input id="opSearch" placeholder="Cari produk..."><button class="primary" id="saveOpname">Simpan Hasil Opname</button></div><div id="opTable"></div></section>`;const draw=()=>{$('#opTable').innerHTML=table(products.filter(p=>p.name.toLowerCase().includes($('#opSearch').value.toLowerCase())),['Produk','Stok Sistem','Stok Fisik','Selisih'],p=>`<td>${p.name}</td><td>${p.stock}</td><td><input type="number" min="0" data-actual="${p.id}" placeholder="${p.stock}" style="width:110px"></td><td id="diff-${p.id}">—</td>`);};draw();$('#opSearch').oninput=draw;$('#opTable').oninput=e=>{const id=e.target.dataset.actual;if(id){const p=products.find(x=>x.id===id);$('#diff-'+id).textContent=Number(e.target.value)-p.stock;}};$('#saveOpname').onclick=async()=>{const inputs=[...$('#opTable').querySelectorAll('[data-actual]')].filter(x=>x.value!=='');if(!inputs.length)return toast('Isi minimal satu stok fisik.');for(const x of inputs){const p=products.find(z=>z.id===x.dataset.actual),actual=Number(x.value);if(!Number.isInteger(actual)||actual<0)return toast('Stok fisik harus bilangan bulat ≥ 0.');const delta=actual-p.stock;if(delta){await movement(p,'opname',delta,'Penyesuaian stok fisik');await put('opnames',{id:uid(),productId:p.id,system:p.stock-delta,actual,delta,time:date(),user:user.name});}}toast('Hasil opname disimpan.');render();};}
function renderContacts(c){c.innerHTML=heading('Pelanggan & Supplier','Data kontak pendukung transaksi.')+`<div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr))"><section class="panel"><div class="panel-head"><h3>Pelanggan</h3><button class="primary" id="addCustomer">Tambah</button></div>${table(customers,['Nama','Telepon'],x=>`<td>${x.name}</td><td>${x.phone}</td>`)}</section><section class="panel"><div class="panel-head"><h3>Supplier</h3><button class="primary" id="addSupplier">Tambah</button></div>${table(suppliers,['Nama','Telepon'],x=>`<td>${x.name}</td><td>${x.phone}</td>`)}</section></div>`;[['Customer','customers'],['Supplier','suppliers']].forEach(([label,store])=>{$('#add'+label).onclick=()=>modal('Tambah '+label,`<div class="form-grid"><div class="field"><label>Nama</label><input id="nm"></div><div class="field"><label>Telepon</label><input id="ph"></div></div>`,async()=>{if(!$('#nm').value.trim())throw Error('Nama wajib diisi.');await put(store,{id:uid(),name:$('#nm').value.trim(),phone:$('#ph').value.trim()});toast('Data disimpan.');render();});});}
function bindCommon(){$('#seedBtn')?.addEventListener('click',seed);$('#exportBtn')?.addEventListener('click',exportCSV);$('#importCsv')?.addEventListener('change',importCSV);}
function exportCSV(){const rows=[['sku','barcode','name','category','shelf','cost','price','minStock','stock','baseUnit','expiry'],...products.map(p=>[p.sku,p.barcode,p.name,categories.find(c=>c.id===p.categoryId)?.name||'',p.shelf,p.cost,p.price,p.minStock,p.stock,p.baseUnit,p.expiry])];const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');download('produk-mambo.csv','text/csv;charset=utf-8','\ufeff'+csv);}
function download(name,type,data){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([data],{type}));a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
async function importCSV(e){const file=e.target.files[0];if(!file)return;const lines=(await file.text()).replace(/^\ufeff/,'').split(/\r?\n/).filter(Boolean);const parse=s=>{const out=[];let v='',q=false;for(let i=0;i<s.length;i++){if(s[i]==='"'&&s[i+1]==='"'&&q){v+='"';i++;}else if(s[i]==='"')q=!q;else if(s[i]===','&&!q){out.push(v);v='';}else v+=s[i];}out.push(v);return out;};const headers=parse(lines.shift()).map(x=>x.toLowerCase());let count=0;for(const line of lines){const r=parse(line),o=Object.fromEntries(headers.map((h,i)=>[h,r[i]??'']));if(!o.sku||!o.name)continue;let cat=categories.find(x=>x.name.toLowerCase()===o.category?.toLowerCase());if(!cat){cat={id:uid(),name:o.category||'Umum'};await put('categories',cat);categories.push(cat);}const old=products.find(x=>x.sku===o.sku);await put('products',{...(old||{}),id:old?.id||uid(),sku:o.sku,barcode:o.barcode||'',name:o.name,categoryId:cat.id,shelf:o.shelf||'',cost:Number(o.cost)||0,price:Number(o.price)||0,minStock:Number(o.minstock)||0,stock:Number(o.stock)||0,baseUnit:o.baseunit||'Pcs',expiry:o.expiry||'',units:[{name:o.baseunit||'Pcs',factor:1,price:Number(o.price)||0}],wholesale:[],bundle:[]});count++;}toast(`${count} produk diimpor/diperbarui.`);e.target.value='';render();}
function printLabel(p){const w=window.open('','_blank','width=420,height=600');if(!w)return toast('Izinkan pop-up untuk mencetak label.');w.document.write(`<html><head><title>Label Produk</title><style>body{font-family:Arial;padding:20px}.label{border:1px dashed #555;padding:15px;text-align:center;width:230px;margin:10px auto}.barcode{font-family:monospace;font-size:22px;letter-spacing:2px;margin:10px 0}</style></head><body><div class="label"><b>${p.name}</b><div class="barcode">${p.barcode||p.sku}</div><div>${p.sku}</div><h2>${money(p.price)}</h2></div><script>window.print()<\/script></body></html>`);w.document.close();}
$('#ownerCloudLoginBtn')?.addEventListener('click',async()=>{
 const btn=$('#ownerCloudLoginBtn'),err=$('#ownerCloudLoginError');btn.disabled=true;err.textContent='Memeriksa akun Owner dan mengambil data toko…';
 try{
  const result=await cloudSignInOwner($('#ownerCloudEmail').value.trim(),$('#ownerCloudPassword').value);
  let owner=(await all('users')).find(x=>x.role==='owner'&&x.active!==false);
  if(!owner){const id=crypto.randomUUID();await createUser('Owner','owner',crypto.randomUUID().replace(/-/g,'').slice(0,6),id);owner=(await all('users')).find(x=>x.id===id);}
  user={...owner,email:result.user?.email};localStorage.setItem(LOCAL_SESSION_KEY,owner.id);page='dashboard';$('#loginPin').value='';shell();toast('Owner berhasil masuk. '+result.pulled+' data cloud diperiksa; '+result.applied+' data diterapkan.');
 }catch(e){err.textContent='Login Owner gagal: '+(e.message||e);}
 finally{btn.disabled=false;}
});
$('#ownerRegisterBtn')?.addEventListener('click',async()=>{
 const btn=$('#ownerRegisterBtn'),err=$('#ownerRegisterError');btn.disabled=true;err.textContent='Mendaftarkan akun dan membuat toko…';
 try{
  const store=$('#ownerRegisterStore').value.trim(),email=$('#ownerRegisterEmail').value.trim(),password=$('#ownerRegisterPassword').value;
  if(!store||!email||!password)throw Error('Nama toko, email, dan password wajib diisi.');
  if(password.length<8)throw Error('Password minimal 8 karakter.');
  const result=await cloudRegisterOwner(email,password,store);
  if(result.needsConfirmation){err.textContent='Pendaftaran diterima. Silakan konfirmasi email, lalu masuk melalui form Owner.';}
  else{err.textContent='Akun dan toko berhasil dibuat. Silakan masuk sebagai Owner.';$('#ownerCloudEmail').value=email;$('#ownerCloudPassword').value='';}
 }catch(e){err.textContent='Pendaftaran gagal: '+(e.message||e);}
 finally{btn.disabled=false;}
});
$('#loginBtn').onclick=async()=>{const btn=$('#loginBtn');btn.disabled=true;$('#loginError').textContent='Memeriksa akun…';let u;try{u=await loginDeviceStaffAuto($('#loginUsername').value.trim(),$('#loginPin').value);}catch(err){$('#loginError').textContent=err.message||'Login gagal.';btn.disabled=false;return;}if(!u){$('#loginError').textContent='Username atau password/PIN tidak sesuai.';btn.disabled=false;return;}user=u;localStorage.setItem(LOCAL_SESSION_KEY,String(user.username||''));page='dashboard';await audit(user,'LOGIN','Berhasil masuk');shell();startDeviceDataSync();};$('#profileBtn')?.addEventListener('click',async()=>{
 if(user?.role==='owner'){
  const current=(await cloudStatus()).authenticated;
  if(!current)return toast('Sesi Owner Cloud belum aktif.');
  const email=prompt('Email Owner:',user.email||'ceoesmambo@gmail.com');if(email===null)return;
  const password=prompt('Password baru (kosongkan jika tidak ingin mengganti):');if(password===null)return;
  if(password&&password.length<8)return toast('Password minimal 8 karakter.');
  try{const result=await cloudUpdateOwnerProfile({email:email.trim(),password});user.email=result.email||email.trim();toast('Profil Owner diperbarui. Jika email berubah, konfirmasi melalui email baru mungkin diperlukan.');}
  catch(e){toast('Gagal memperbarui profil Owner: '+(e.message||e));}
  return;
 }
 if(!user?.sharedDrawerSession)return toast('Profil karyawan hanya tersedia untuk akun karyawan yang login dari HP terpasangkan.');
 const name=prompt('Nama tampilan:',user.name||'');if(name===null)return;
 const password=prompt('Password baru (kosongkan jika tidak ingin mengganti):');if(password===null)return;
 if(password&&password.length<8)return toast('Password minimal 8 karakter.');
 try{await updateDeviceStaffProfile(name.trim(),password);user.name=name.trim();shell();toast('Profil berhasil diperbarui.');}catch(e){toast('Gagal memperbarui profil: '+(e.message||e));}
});$('#logout').onclick=async()=>{try{if(devicePaired())await logoutDeviceStaff();}catch(err){console.warn('Logout sesi kasir:',err.message);}audit(user,'LOGOUT','Keluar aplikasi');user=null;localStorage.removeItem(LOCAL_SESSION_KEY);localStorage.removeItem('mambo_owner_cloud_session');$('#app').classList.add('hidden');$('#login').classList.remove('hidden');$('#loginPin').value='';};const isTouchNavigation=()=>!!(window.matchMedia&&window.matchMedia('(hover: none) and (pointer: coarse)').matches)||window.innerWidth<=680;const syncNavigationMode=()=>{const side=$('.sidebar'),toggle=$('#menuToggle');if(!side)return;side.style.removeProperty('transform');side.style.removeProperty('position');if(toggle)toggle.style.removeProperty('display');if(!isTouchNavigation())side.classList.remove('open');};syncNavigationMode();window.addEventListener('resize',syncNavigationMode);window.addEventListener('orientationchange',syncNavigationMode);$('#nav').onclick=e=>{const b=e.target.closest('[data-page]');if(!b||!can(user,b.dataset.page))return;page=b.dataset.page;$('.sidebar')?.classList.remove('open');shell();};$('#themeToggle').onclick=()=>document.body.classList.toggle('dark');$('#menuToggle').onclick=()=>{if(!isTouchNavigation())return;const side=$('.sidebar');side.classList.toggle('open');};
window.addEventListener('error',e=>{console.error(e.error||e.message);const t=$('#toast');if(t){t.textContent='Terjadi kesalahan aplikasi. Data yang tersimpan tetap dipertahankan.';t.classList.add('show');}});window.addEventListener('unhandledrejection',e=>{console.error(e.reason);const t=$('#toast');if(t){t.textContent='Operasi gagal. Silakan coba kembali.';t.classList.add('show');}});
(async()=>{try{startCloudSync();await refresh();const ownerSessionRaw=localStorage.getItem('mambo_owner_cloud_session');let ownerSession=null;try{ownerSession=ownerSessionRaw?JSON.parse(ownerSessionRaw):null;}catch(e){localStorage.removeItem('mambo_owner_cloud_session');}const savedOwnerId=localStorage.getItem(LOCAL_SESSION_KEY);if(ownerSession&&ownerSession.id&&ownerSession.role==='owner'&&ownerSession.active!==false&&String(ownerSession.id)===String(savedOwnerId)){user=ownerSession;page='dashboard';shell();return;}if(ownerSessionRaw){localStorage.removeItem('mambo_owner_cloud_session');}$('#loginUsername').classList.remove('hidden');$('#loginUsernameLabel').classList.remove('hidden');$('#loginSecretLabel').textContent='Password / PIN';$('#loginBtn').disabled=false;const savedUsername=localStorage.getItem(LOCAL_SESSION_KEY);if(devicePaired()&&savedUsername){const restored=await restoreDeviceStaffSession();if(restored&&String(restored.username)===String(savedUsername)){user=restored;page='dashboard';shell();startDeviceDataSync();}else localStorage.removeItem(LOCAL_SESSION_KEY);}}catch(err){console.error(err);$('#loginError').textContent='Gagal memuat aplikasi: '+(err.message||err);}})();
