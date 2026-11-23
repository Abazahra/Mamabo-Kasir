import {all,put} from './db.js';
const enc=new TextEncoder();
async function hash(pin,salt){const data=enc.encode(`${salt}:${pin}`);const digest=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function createUser(name,role,pin,id=crypto.randomUUID()){const salt=crypto.randomUUID();await put('users',{id,name,role,salt,pinHash:await hash(pin,salt),active:true});}
export async function login(id,pin){const user=(await all('users')).find(u=>u.id===id&&u.active!==false);return user&&await hash(pin,user.salt)===user.pinHash?user:null;}
export const can=(user,permission)=>({owner:['*'],supervisor:['dashboard','products','stock','opname','contacts','void','transactions'],cashier:['dashboard','pos','shift','transactions']}[user?.role]||[]).some(x=>x==='*'||x===permission);
export const roleName=r=>({owner:'Owner',supervisor:'Supervisor',cashier:'Kasir'}[r]||r);
