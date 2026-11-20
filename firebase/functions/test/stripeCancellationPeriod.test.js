import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.JWT_SECRET='local-stripe-period-regression';
process.env.STRIPE_SECRET_KEY='sk_test_local_no_network';
const {stripe,zaplanujAnulowanieNaKoniecOkresu}=await import('../src/services/stripe.js');
test('rezygnacja zwraca faktyczny termin Stripe, także po zmianie API',async t=>{
 const end=1797020452;
 const cases=[
  ['actual Stripe TEST response',{cancel_at:end,items:{data:[{current_period_end:end}]}},end],
  ['legacy response',{current_period_end:end},end],
  ['single item billing period',{items:{data:[{current_period_end:end}]}},end],
  ['explicit cancellation overrides item period',{cancel_at:end,items:{data:[{current_period_end:end+60}]}},end],
  ['ambiguous periods without cancellation',{items:{data:[{current_period_end:end},{current_period_end:end+60}]}},null],
  ['invalid date',{cancel_at:NaN,current_period_end:Infinity},null],
 ];
 for(const [name,response,expected] of cases) await t.test(name,async()=>{
  const previous=stripe.subscriptions.update;
  stripe.subscriptions.update=async(id,params)=>{assert.equal(id,'sub_local_test');assert.deepEqual(params,{cancel_at_period_end:true});return response;};
  try{assert.deepEqual(await zaplanujAnulowanieNaKoniecOkresu('sub_local_test'),{zaplanowana:true,koniecOkresuMs:expected===null?null:expected*1000});}
  finally{stripe.subscriptions.update=previous;}
 });
});

