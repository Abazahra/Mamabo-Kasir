import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../supabase/shared-cash-drawer.sql',import.meta.url),'utf8');
const start=sql.indexOf('create or replace function public.mambo_shared_drawer_event_resolve(');
const end=sql.indexOf('\nend $$;',start);
assert.notEqual(start,-1,'drawer event resolver must exist');
assert.notEqual(end,-1,'drawer event resolver must have a body');
const resolver=sql.slice(start,end);\nconst patch=readFileSync(new URL('../supabase/shared-cash-drawer-confirmation-guard.sql',import.meta.url),'utf8');

test('server refuses to confirm a cash event without its source record',()=>{
 assert.match(resolver,/if\s+p_resolution\s*=\s*'confirmed'[\s\S]*?v_event\.source_record_id/i);
 assert.match(resolver,/from public\.mambo_sync_records[\s\S]*?record_id=v_event\.source_record_id[\s\S]*?deleted=false/i);
 assert.match(resolver,/v_payload->>'id'\s+is distinct from v_event\.source_record_id/i);
});
test('server checks the cash sale amount and paid status before confirmation',()=>{
 assert.match(resolver,/v_payload->>'status'\s*<>\s*'paid'/i);
 assert.match(resolver,/jsonb_array_elements[\s\S]*?v_payload->'payments'/i);
 assert.match(resolver,/abs\(v_expected-v_event\.amount\)>0\.01/i);
});
test('server checks cash expense source and amount before confirmation',()=>{
 assert.match(resolver,/v_payload->>'source'\s*<>\s*'cash'/i);
 assert.match(resolver,/abs\(v_source_amount-v_event\.amount\)>0\.01/i);
});
test('device-originated confirmation checks cashier and device attribution',()=>{
 assert.match(resolver,/v_payload->>'userId'[\s\S]*?v_event\.actor_id::text/i);
 assert.match(resolver,/v_payload->>'deviceId'[\s\S]*?v_event\.device_id::text/i);
});

test('standalone SQL patch carries the same resolver guard',()=>{
 assert.ok(patch.includes(resolver.trim()),'focused patch must stay aligned with the main migration');
});
