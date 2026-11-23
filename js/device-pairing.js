import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {replaceDeviceCatalog,all,put,remove,applyCloudRows} from './db.js?v=operational-normalization-2';
const SUPABASE_URL='https://wtsheaowviaedwhyiwkk.supabase.co';
const SUPABASE_KEY='sb_publishable_P6RPUvaz7-ivBQWiU925zQ_M2ZkDaz0';
const KEY='mambo_paired_device';
const client=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const $=s=>document.querySelector(s);
export async function pairDevice(code,label='Perangkat Kasir'){
 const {data,error}=await client.rpc('mambo_device_redeem_pair_code',{p_code:code,p_label:label});
 if(error)throw error;
 if(!data?.device_token||!data?.store_id)throw Error('Balasan pemasangan tidak lengkap.');
 localStorage.setItem(KEY,JSON.stringify({token:data.device_token,storeId:data.store_id,deviceId:data.device_id,label}));
 return syncDeviceCatalog();
}
export async function syncDeviceCatalog(){
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
 const saved=JSON.parse(localStorage.getItem(KEY)||'null');
 if(!saved?.token)throw Error('Perangkat belum dipasangkan.');
 const {data,error}=await client.rpc('mambo_device_staff_list',{p_device_token:saved.token});
 if(error)throw error;
 return Array.isArray(data)?data:[];
}
export async function loginDeviceStaff(username,pin){
 const saved=JSON.parse(localStorage.getItem(KEY)||'null');
 if(!saved?.token)throw Error('Perangkat belum dipasangkan.');
 const {data,error}=await client.rpc('mambo_device_staff_login',{p_device_token:saved.token,p_username:username,p_pin:pin});
 if(error)throw error;
 if(!data?.id||!data?.role)throw Error('Akun atau PIN tidak sesuai.');
 return {id:data.id,name:data.name,role:data.role,username:data.username,active:true};
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
async function deviceRpc(name,args){const {data,error}=await client.rpc(name,args);if(error)throw error;return data;}
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
   const batch=queue.slice(i,i+300).filter(x=>SYNC_ENTITIES.includes(x.entity))
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

export function devicePaired(){try{return !!JSON.parse(localStorage.getItem(KEY)||'null')?.token;}catch{return false;}}
document.addEventListener('DOMContentLoaded',()=>{
 const btn=$('#pairDeviceBtn'),code=$('#pairDeviceCode'),msg=$('#pairDeviceMessage');
 if(!btn)return;
 btn.onclick=async()=>{
  btn.disabled=true;msg.textContent='Memasang perangkat…';
  try{
   const result=await pairDevice(code.value.trim(),($('#pairDeviceLabel')?.value||'Perangkat Kasir').trim());
   const staff=await listDeviceStaff();
   const loginSelect=$('#loginUser');
   if(loginSelect){
    loginSelect.innerHTML=staff.map(x=>'<option value="'+String(x.username).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'">'+String(x.display_name||x.name||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+' — '+(x.app_role==='cashier'?'Kasir':'Supervisor')+'</option>').join('');
   }
   msg.textContent=staff.length?'Berhasil dipasangkan. '+result.products+' produk dimuat. Silakan pilih akun karyawan dan masukkan PIN.':'HP berhasil dipasangkan, tetapi belum ada akun karyawan aktif. Buat akun dari HP Owner.';
   code.value='';
  }
  catch(e){msg.textContent='Gagal: '+(e.message||e);}
  finally{btn.disabled=false;}
 };
});
