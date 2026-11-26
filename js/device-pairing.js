import {replaceDeviceCatalog,all,put,remove,applyCloudRows} from './db.js?v=operational-normalization-2';
const SUPABASE_URL='https://wtsheaowviaedwhyiwkk.supabase.co';
const SUPABASE_KEY='sb_publishable_P6RPUvaz7-ivBQWiU925zQ_M2ZkDaz0';
const KEY='mambo_paired_device';
let client=null,clientPromise=null;
async function ensureClient(){
 if(client)return client;
 if(!clientPromise)clientPromise=import('https://esm.sh/@supabase/supabase-js@2').then(({createClient})=>{
  client=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  return client;
 }).catch(error=>{clientPromise=null;throw Error('Pustaka koneksi server gagal dimuat. Periksa internet lalu muat ulang halaman. Detail: '+(error.message||error));});
 return clientPromise;
}
const $=s=>document.querySelector(s);
export async function pairDevice(code,label='Perangkat Kasir'){
 await ensureClient();
 const {data,error}=await client.rpc('mambo_device_redeem_pair_code',{p_code:code,p_label:label});
 if(error)throw error;
 if(!data?.device_token||!data?.store_id)throw Error('Balasan pemasangan tidak lengkap.');
 localStorage.setItem(KEY,JSON.stringify({token:data.device_token,storeId:data.store_id,deviceId:data.device_id,label}));
 return syncDeviceCatalog();
}
export async function syncDeviceCatalog(){
 await ensureClient();
 const saved=JSON.parse(localStorage.getItem(KEY)||'null');
 if(!saved?.token)throw Error('Perangkat belum dipasangkan.');
 const {data,error}=await client.rpc('mambo_device_catalog_snapshot',{p_device_token:saved.token});
 if(error)throw error;
 if(!data||data.store_id!==saved.storeId)throw Error('Identitas toko perangkat tidak cocok.');
 const result=await replaceDeviceCatalog(data.products||[],data.categories||[]);
 localStorage.setItem(KEY,JSON.stringify({...saved,lastSyncAt:new Date().toISOString()}));
 return result;
}

export async function listDeviceStaff(){
 await ensureClient();
 const saved=JSON.parse(localStorage.getItem(KEY)||'null');
 if(!saved?.token)throw Error('Perangkat belum dipasangkan.');
 const {data,error}=await client.rpc('mambo_device_staff_list',{p_device_token:saved.token});
 if(error)throw error;
 return Array.isArray(data)?data:[];
}
export async function listDeviceStaffRoles(){
 await ensureClient();
 const saved=JSON.parse(localStorage.getItem(KEY)||'null');
 if(!saved?.token)throw Error('Perangkat belum dipasangkan.');
 const {data,error}=await client.rpc('mambo_device_staff_roles',{p_device_token:saved.token});
 if(error)throw error;
 return Array.isArray(data)?data:[];
}
export async function acceptStaffInvitation(token,password){
 await ensureClient();
 const {data,error}=await client.rpc('mambo_staff_invitation_accept',{p_token:token,p_password:password});
 if(error)throw error;return data;
}
async function staffInvitationInfo(token){
 await ensureClient();
 const {data,error}=await client.rpc('mambo_staff_invitation_info',{p_token:token});
 if(error)throw error;return data;
}
const STAFF_SESSION_KEY='mambo_device_staff_session';
export async function loginDeviceStaffAuto(username,password){
 await ensureClient();
 const existing=JSON.parse(localStorage.getItem(KEY)||'null');
 const label=(navigator.userAgent||'Browser otomatis').slice(0,72);
 const {data,error}=await client.rpc('mambo_staff_login_auto',{
  p_username:username,
  p_password:password,
  p_device_label:label,
  p_existing_device_token:existing?.token||null
 });
 if(error)throw error;
 if(!data?.id||!data?.staff_session_token||!data?.device_token||!data?.store_id)throw Error('Server belum mengembalikan sesi kasir yang lengkap.');
 const saved={token:data.device_token,storeId:data.store_id,deviceId:data.device_id,label,lastSyncAt:null};
 localStorage.setItem(KEY,JSON.stringify(saved));
 localStorage.setItem(STAFF_SESSION_KEY,JSON.stringify({
  token:data.staff_session_token,
  expiresAt:data.staff_session_expires_at,
  staffId:data.id,
  username:data.username,
  deviceId:data.device_id,
  storeId:data.store_id
 }));
 await syncDeviceCatalog();
 return {id:data.id,name:data.name,role:data.role,jobTitle:data.job_title,username:data.username,active:true,sharedDrawerSession:true};
}
export async function loginDeviceStaff(username,pin,roleId){
 await ensureClient();
 const saved=JSON.parse(localStorage.getItem(KEY)||'null');
 if(!saved?.token)throw Error('Perangkat belum dipasangkan.');
 const {data,error}=await client.rpc('mambo_device_staff_login',{p_device_token:saved.token,p_username:username,p_pin:pin,p_role_id:roleId});
 if(error)throw error;
 if(!data?.id||!data?.role||!data?.staff_session_token)throw Error('Server belum mengaktifkan sesi kasir bersama. Jalankan migrasi shared-cash-drawer.sql terlebih dahulu.');
 const session={token:data.staff_session_token,expiresAt:data.staff_session_expires_at,staffId:data.id,username:data.username,deviceId:data.device_id,storeId:data.store_id};
 localStorage.setItem(STAFF_SESSION_KEY,JSON.stringify(session));
 return {id:data.id,name:data.name,role:data.role,jobTitle:data.job_title,username:data.username,active:true,sharedDrawerSession:true};
}
export async function restoreDeviceStaffSession(){
 const saved=JSON.parse(localStorage.getItem(KEY)||'null');
 const session=JSON.parse(localStorage.getItem(STAFF_SESSION_KEY)||'null');
 if(!saved?.token||!session?.token)return null;
 await ensureClient();
 const {data,error}=await client.rpc('mambo_device_staff_session_check',{p_device_token:saved.token,p_staff_session_token:session.token});
 if(error){localStorage.removeItem(STAFF_SESSION_KEY);return null;}
 if(!data?.active||String(data.id)!==String(session.staffId)){localStorage.removeItem(STAFF_SESSION_KEY);return null;}
 return {id:data.id,name:data.name,role:data.role,jobTitle:data.job_title,username:data.username,active:true,sharedDrawerSession:true};
}
export async function logoutDeviceStaff(){
 const saved=JSON.parse(localStorage.getItem(KEY)||'null');
 const session=JSON.parse(localStorage.getItem(STAFF_SESSION_KEY)||'null');
 try{if(saved?.token&&session?.token){await ensureClient();await client.rpc('mambo_device_staff_logout',{p_device_token:saved.token,p_staff_session_token:session.token});}}
 finally{localStorage.removeItem(STAFF_SESSION_KEY);}
}
export async function supervisorExpenseCategoryAccess(){
 await ensureClient();
 const saved=JSON.parse(localStorage.getItem(KEY)||'null');
 const session=JSON.parse(localStorage.getItem(STAFF_SESSION_KEY)||'null');
 if(!saved?.token||!session?.token)throw Error('Sesi Supervisor perangkat belum aktif.');
 const {data,error}=await client.rpc('mambo_shared_drawer_supervisor_expense_status',{p_device_token:saved.token,p_staff_session_token:session.token});
 if(error)throw error;return !!data;
}

export async function sharedDrawerSnapshot(){
 await ensureClient();
 const saved=JSON.parse(localStorage.getItem(KEY)||'null');
 const session=JSON.parse(localStorage.getItem(STAFF_SESSION_KEY)||'null');
 if(!saved?.token||!session?.token)throw Error('Sesi kasir perangkat belum aktif.');
 const {data,error}=await client.rpc('mambo_shared_drawer_snapshot',{p_store_id:saved.storeId,p_device_token:saved.token,p_staff_session_token:session.token});
 if(error)throw error;return data;
}
export async function syncSharedDrawerSourceRecord(entity,record){
 if(!['transactions','operationalExpenses'].includes(entity)||!record?.id)throw Error('Record sumber pergerakan kas tidak valid.');
 const saved=JSON.parse(localStorage.getItem(KEY)||'null');
 if(!saved?.token)throw Error('Perangkat belum dipasangkan.');
 return deviceRpc('mambo_device_sync_push',{
  p_device_token:saved.token,
  p_records:[{entity,record_id:String(record.id),payload:record,deleted:false}],
  p_insert_only:false
 });
}
export async function resolveSharedDrawerEvent(eventId,resolution){await ensureClient();const saved=JSON.parse(localStorage.getItem(KEY)||'null'),session=JSON.parse(localStorage.getItem(STAFF_SESSION_KEY)||'null');if(!saved?.token||!session?.token)throw Error('Sesi kasir perangkat belum aktif.');const {data,error}=await client.rpc('mambo_shared_drawer_event_resolve',{p_store_id:saved.storeId,p_event_id:eventId,p_resolution:resolution,p_device_token:saved.token,p_staff_session_token:session.token});if(error)throw error;return data;}
export async function appendSharedDrawerEvent(event){
 await ensureClient();
 const saved=JSON.parse(localStorage.getItem(KEY)||'null');
 const session=JSON.parse(localStorage.getItem(STAFF_SESSION_KEY)||'null');
 if(!saved?.token||!session?.token)throw Error('Sesi kasir perangkat belum aktif.');
 const {data,error}=await client.rpc('mambo_shared_drawer_event',{
  p_device_token:saved.token,p_staff_session_token:session.token,p_event_id:event.eventId,
  p_event_type:event.type,p_amount:event.amount,p_source_record_id:event.sourceRecordId||null,p_note:event.note||null
 });
 if(error)throw error;return data;
}

export async function supervisorSharedDrawerControl(action,openingCash=null,countedCash=null){
 await ensureClient();
 const saved=JSON.parse(localStorage.getItem(KEY)||'null');
 const session=JSON.parse(localStorage.getItem(STAFF_SESSION_KEY)||'null');
 if(!saved?.token||!session?.token)throw Error('Sesi Supervisor perangkat belum aktif.');
 const {data,error}=await client.rpc('mambo_shared_drawer_supervisor_control',{
  p_device_token:saved.token,p_staff_session_token:session.token,p_action:action,
  p_opening_cash:openingCash,p_counted_cash:countedCash,p_actor_name:session.name||'Supervisor'
 });
 if(error)throw error;return data;
}

export async function flushPendingSharedDrawerEvents(){
 const pending=JSON.parse(localStorage.getItem('mambo_pending_drawer_events')||'[]');
 if(!pending.length)return {sent:0,pending:0};
 let sent=0;const remain=[];
 for(const event of pending){
  try{
   const snapshot=await appendSharedDrawerEvent(event);
   if(event.type==='cash_sale'||event.type==='cash_expense'){
    const existing=(snapshot?.events||[]).find(row=>String(row.event_id)===String(event.eventId));
    // Event yang sudah confirmed tampil di snapshot; event reversed tidak ditampilkan.
    // Jangan mencoba mengubah status final atau membalik event yang sudah diputus Owner.
    if(existing?.resolution_status==='pending'){
     const entity=event.type==='cash_sale'?'transactions':'operationalExpenses';
     const rows=await all(entity);
     const source=rows.find(row=>String(row.id)===String(event.sourceRecordId||event.eventId));
     if(source){
      // Pastikan bukti transaksi sudah diterima server sebelum ledger kas dikonfirmasi.
      await deviceRpc('mambo_device_sync_push',{
       p_device_token:JSON.parse(localStorage.getItem(KEY)||'null')?.token,
       p_records:[{entity,record_id:String(source.id),payload:source,deleted:false}],
       p_insert_only:false
      });
      await resolveSharedDrawerEvent(event.eventId,'confirmed');
     }else await resolveSharedDrawerEvent(event.eventId,'reversed');
    }
   }
   sent++;
  }catch(err){remain.push(event);}
 }
 localStorage.setItem('mambo_pending_drawer_events',JSON.stringify(remain));
 return {sent,pending:remain.length};
}



const SYNC_ENTITIES=['transactions','shifts','movements','receivables','returns','auditLogs','opnames','purchases','payables','supplierPayments','promos','customers','suppliers','settings','operationalExpenses'];
const INITIAL_SYNC_KEY='mambo_device_initial_data_sync_v1';
const LEGACY_CASHIER_IDS=new Set([
 '1d25c016-9e7f-4890-9bdc-6f4d6b86c8f1',
 'a5bc3a4c-5b7b-4e23-ba97-976e7775b98d'
]);
const CURRENT_CASHIER={id:'7e9f4a2e-5999-4484-a3f4-f76e270e5cf9',name:'nizar'};
function normalizeLegacyCashier(entity,row){
 if(!['transactions','shifts'].includes(entity)||!row||!LEGACY_CASHIER_IDS.has(String(row.userId)))return row;
 return {...row,userId:CURRENT_CASHIER.id,userName:CURRENT_CASHIER.name};
}
async function migrateLegacyCashierLocalData(){
 for(const entity of ['transactions','shifts']){
  const rows=await all(entity);
  for(const row of rows){
   const migrated=normalizeLegacyCashier(entity,row);
   if(migrated!==row)await put(entity,migrated);
  }
 }
}

let deviceSyncBusy=false,deviceSyncTimer=null;
async function deviceRpc(name,args){await ensureClient();const {data,error}=await client.rpc(name,args);if(error)throw error;return data;}
export async function syncDeviceData(){
 if(deviceSyncBusy||!navigator.onLine)return {skipped:true};
 const saved=JSON.parse(localStorage.getItem(KEY)||'null');
 if(!saved?.token)return {skipped:true};
 deviceSyncBusy=true;
 try{
  // Alihkan data lokal Kasir-1 sebelum push awal maupun antrean sinkronisasi.
  await migrateLegacyCashierLocalData();
  if(localStorage.getItem(INITIAL_SYNC_KEY)!=='done'){
   // Migrasi awal bersifat insert-only: data lokal lama tidak menimpa record pusat yang sudah ada.
   for(const entity of SYNC_ENTITIES){
    const rows=await all(entity);
    for(let i=0;i<rows.length;i+=300){
     const batch=rows.slice(i,i+300).map(row=>({entity,record_id:String(row.id),payload:row}));
     if(batch.length)await deviceRpc('mambo_device_sync_push',{p_device_token:saved.token,p_records:batch,p_insert_only:true});
    }
   }
   localStorage.setItem(INITIAL_SYNC_KEY,'done');
  }
  // Kirim perubahan terbaru dari antrean lokal.
  const queue=(await all('syncQueue')).sort((a,b)=>a.createdAt-b.createdAt);
  for(let i=0;i<queue.length;i+=300){
   const batch=queue.slice(i,i+300).filter(x=>SYNC_ENTITIES.includes(x.entity)&&x.entity!=='shifts')
    .map(x=>({entity:x.entity,record_id:String(x.recordId),payload:normalizeLegacyCashier(x.entity,x.payload||{}),deleted:x.operation==='delete'}));
   if(batch.length)await deviceRpc('mambo_device_sync_push',{p_device_token:saved.token,p_records:batch,p_insert_only:false});
   for(const item of queue.slice(i,i+300))if(SYNC_ENTITIES.includes(item.entity))await remove('syncQueue',item.id);
  }
  const rows=await deviceRpc('mambo_device_sync_pull',{p_device_token:saved.token});
  const result=await applyCloudRows(Array.isArray(rows)?rows:[]);
  window.dispatchEvent(new CustomEvent('mambo-cloud-pulled',{detail:result}));
  window.dispatchEvent(new CustomEvent('mambo-device-sync',{detail:{ok:true,applied:result.applied}}));
  return result;
 }catch(e){
  console.warn('Sinkronisasi data perangkat:',e.message);
  window.dispatchEvent(new CustomEvent('mambo-device-sync',{detail:{ok:false,error:e.message}}));
  throw e;
 }finally{deviceSyncBusy=false;}
}
export function startDeviceDataSync(){
 if(deviceSyncTimer)return;
 const tick=()=>syncDeviceData().catch(()=>{});
 tick();
 deviceSyncTimer=setInterval(tick,15000);
 window.addEventListener('online',tick);
}


export async function updateDeviceStaffProfile(displayName,newPassword=''){
 await ensureClient();
 const saved=JSON.parse(localStorage.getItem(KEY)||'null'),session=JSON.parse(localStorage.getItem(STAFF_SESSION_KEY)||'null');
 if(!saved?.token||!session?.token)throw Error('Sesi karyawan perangkat belum aktif.');
 const {data,error}=await client.rpc('mambo_device_staff_update_self',{p_device_token:saved.token,p_staff_session_token:session.token,p_display_name:displayName,p_new_password:newPassword||null});
 if(error)throw error;
 return data;
}

export function devicePaired(){try{return !!JSON.parse(localStorage.getItem(KEY)||'null')?.token;}catch{return false;}}
document.addEventListener('DOMContentLoaded',async()=>{
 const token=new URLSearchParams(location.search).get('invite');
 if(token){
  const card=$('.login-card');
  const panel=document.createElement('section');panel.className='panel';panel.style.marginTop='16px';
  panel.innerHTML='<h3>Aktivasi Undangan Karyawan</h3><p id="inviteInfo">Memeriksa undangan…</p><label>Buat password (minimal 8 karakter)</label><input id="invitePassword" type="password" autocomplete="new-password"><label>Ulangi password</label><input id="invitePassword2" type="password" autocomplete="new-password"><button id="inviteAccept" class="primary full" type="button">Aktifkan Akun</button><p id="inviteError" class="error"></p>';
  card?.prepend(panel);
  try{
   const info=await staffInvitationInfo(token);
   panel.querySelector('#inviteInfo').textContent=info.display_name+' — '+info.job_title+' · '+info.store_name+'. Undangan berlaku sampai '+new Date(info.expires_at).toLocaleString('id-ID')+'.';
   panel.querySelector('#inviteAccept').onclick=async()=>{
    const p=panel.querySelector('#invitePassword').value,p2=panel.querySelector('#invitePassword2').value;
    if(p.length<8){panel.querySelector('#inviteError').textContent='Password minimal 8 karakter.';return;}
    if(p!==p2){panel.querySelector('#inviteError').textContent='Konfirmasi password tidak sama.';return;}
    const accept=panel.querySelector('#inviteAccept');accept.disabled=true;
    try{await acceptStaffInvitation(token,p);panel.querySelector('#inviteError').textContent='Akun aktif. Buka halaman login pada perangkat yang sudah dipasangkan, pilih jabatan '+info.job_title+', lalu masuk dengan username dan password baru.';history.replaceState({},'',location.pathname);panel.querySelector('#invitePassword').value='';panel.querySelector('#invitePassword2').value='';}
    catch(e){panel.querySelector('#inviteError').textContent=e.message||String(e);}
    finally{accept.disabled=false;}
   };
  }catch(e){panel.querySelector('#inviteInfo').textContent='Undangan tidak dapat digunakan.';panel.querySelector('#inviteError').textContent=e.message||String(e);}
 }
});
