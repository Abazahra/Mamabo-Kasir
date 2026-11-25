import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePendingDrawerRecord} from '../js/shared-drawer-validation.mjs';

const saleEvent={event_type:'cash_sale',source_record_id:'tx-1',amount:40,actor_id:'staff-1',device_id:'device-1'};
const saleRow={record_id:'tx-1',deleted:false,payload:{id:'tx-1',status:'paid',total:100,userId:'staff-1',deviceId:'device-1',payments:[{method:'Tunai',amount:40},{method:'Transfer',amount:60}]}};

test('accepts a matching split-payment cash sale',()=>{
 assert.equal(validatePendingDrawerRecord(saleEvent,saleRow).valid,true);
});
test('rejects a cash sale whose ledger amount differs from the saved cash portion',()=>{
 assert.equal(validatePendingDrawerRecord({...saleEvent,amount:41},saleRow).valid,false);
});
test('rejects a cash sale attributed to another device or cashier',()=>{
 assert.equal(validatePendingDrawerRecord(saleEvent,{...saleRow,payload:{...saleRow.payload,deviceId:'other-device'}}).valid,false);
 assert.equal(validatePendingDrawerRecord(saleEvent,{...saleRow,payload:{...saleRow.payload,userId:'other-staff'}}).valid,false);
});
test('rejects void or unpaid sales',()=>{
 assert.equal(validatePendingDrawerRecord(saleEvent,{...saleRow,payload:{...saleRow.payload,status:'void'}}).valid,false);
});
test('accepts a matching cash expense and rejects a non-cash expense',()=>{
 const event={event_type:'cash_expense',source_record_id:'exp-1',amount:25000,actor_id:'staff-1',device_id:'device-1'};
 const row={record_id:'exp-1',deleted:false,payload:{id:'exp-1',amount:25000,source:'cash',userId:'staff-1',deviceId:'device-1'}};
 assert.equal(validatePendingDrawerRecord(event,row).valid,true);
 assert.equal(validatePendingDrawerRecord(event,{...row,payload:{...row.payload,source:'noncash'}}).valid,false);
});
test('does not validate missing, deleted, or unrelated records',()=>{
 assert.equal(validatePendingDrawerRecord(saleEvent,null).valid,false);
 assert.equal(validatePendingDrawerRecord(saleEvent,{...saleRow,deleted:true}).valid,false);
 assert.equal(validatePendingDrawerRecord({...saleEvent,event_type:'cash_in'},saleRow).valid,false);
});

test('rejects a source record ID that differs from the ledger event reference',()=>{
 assert.equal(validatePendingDrawerRecord({...saleEvent,source_record_id:'other-tx'},saleRow).valid,false);
});
