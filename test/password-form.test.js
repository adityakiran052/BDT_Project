import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupPasswordForm} from '../public/password.js';

test('password form reports validation and server failures beside Save and permits retry',async()=>{
  const NativeFormData=globalThis.FormData;
  globalThis.FormData=class {constructor(form){this.values=form.values;}[Symbol.iterator](){return Object.entries(this.values)[Symbol.iterator]();}};
  try {
    const button={disabled:false},status={textContent:''};let requests=0,successes=0,handler,resetCount=0,rejectRequest=true;
    const form={values:{currentPassword:'CollegeDemo123!',newPassword:'short',confirmPassword:'short'},querySelector:()=>button,addEventListener:(event,fn)=>{assert.equal(event,'submit');handler=fn;},reset:()=>{resetCount++;}};
    setupPasswordForm({form,status,submit:async()=>{requests++;if(rejectRequest)throw new Error('Current password is incorrect');},onSuccess:()=>{successes++;}});
    assert.equal(form.noValidate,true);
    const save=()=>handler({preventDefault(){}});
    await save();assert.match(status.textContent,/8 to 200/);assert.equal(requests,0);
    form.values.newPassword='ChangedCollege123!';await save();assert.match(status.textContent,/do not match/);assert.equal(requests,0);
    form.values.confirmPassword='ChangedCollege123!';await save();assert.equal(status.textContent,'Current password is incorrect');assert.equal(button.disabled,false);assert.equal(resetCount,0);
    rejectRequest=false;await save();assert.equal(successes,1);assert.equal(resetCount,1);assert.equal(status.textContent,'');assert.equal(button.disabled,false);
  } finally {globalThis.FormData=NativeFormData;}
});
