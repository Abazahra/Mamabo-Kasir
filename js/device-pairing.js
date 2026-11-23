import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {replaceDeviceCatalog} from './db.js?v=device-pair-1';
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

export function devicePaired(){try{return !!JSON.parse(localStorage.getItem(KEY)||'null')?.token;}catch{return false;}}
document.addEventListener('DOMContentLoaded',()=>{
 const btn=$('#pairDeviceBtn'),code=$('#pairDeviceCode'),msg=$('#pairDeviceMessage');
 if(!btn)return;
 btn.onclick=async()=>{
  btn.disabled=true;msg.textContent='Memasang perangkat…';
  try{const result=await pairDevice(code.value.trim(),($('#pairDeviceLabel')?.value||'Perangkat Kasir').trim());msg.textContent='Berhasil. '+result.products+' produk dan '+result.categories+' kategori dimuat. Silakan masuk sebagai Kasir.';code.value='';}
  catch(e){msg.textContent='Gagal: '+(e.message||e);}
  finally{btn.disabled=false;}
 };
});
