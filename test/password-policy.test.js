import {test} from 'node:test';
import assert from 'node:assert/strict';
import {passwordPolicyError} from '../public/password-policy.js';
test('password policy requires eight characters, capital, number and special character',()=>{
  assert.equal(passwordPolicyError('Test@123'),'');
  assert.match(passwordPolicyError('Te@123'),/8 to 200/);
  assert.match(passwordPolicyError('test@123'),/capital/);
  assert.match(passwordPolicyError('Test@abc'),/number/);
  assert.match(passwordPolicyError('Testa123'),/special/);
  assert.match(passwordPolicyError('Test 123'),/special/);
});
