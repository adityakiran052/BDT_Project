import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterAccounts} from '../public/accounts.js';
test('account filter matches name, email and role without case sensitivity',()=>{
  const accounts=[{name:'Asha Rao',email:'asha@college.edu',role:'faculty'},{name:'Kiran Kumar',email:'kiran@college.edu',role:'student'}];
  assert.equal(filterAccounts(accounts,' ASHA ')[0],accounts[0]);
  assert.equal(filterAccounts(accounts,'kiran@')[0],accounts[1]);
  assert.equal(filterAccounts(accounts,'FACULTY').length,1);
  assert.equal(filterAccounts(accounts,'unknown').length,0);
  assert.equal(filterAccounts(accounts,'').length,2);
});
