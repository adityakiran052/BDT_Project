import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.js';
import {MemoryStore,CouchStore,searchSelector} from '../store.js';
test('student search builds a CouchDB selector with literal text and approval protection',()=>{
  const selector=searchSelector({role:'student',_id:'student'},{department:'CSE',status:'pending'},'notes.*');
  assert.equal(selector.status,'approved');assert.equal(selector.department,'CSE');
  assert.equal(selector.$and[0].$or[0].title.$regex,'(?i)notes\\.\\*');
});
test('role security, approval, attachments and version visibility',async()=>{
  process.env.ADMIN_PASSWORD='AdminDemo123!';process.env.DEMO_SEED='true';
  if(process.env.TEST_COUCHDB==='true') process.env.COUCHDB_DB='colledocs_test_'+Date.now();
  const store=process.env.TEST_COUCHDB==='true'?new CouchStore():new MemoryStore();
  const server=(await createApp(store)).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const call=(path,cookie,body)=>fetch(base+path,{headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const login=async role=>{const r=await call('/login',null,{email:role+'@college.edu',password:role==='admin'?'AdminDemo123!':'CollegeDemo123!'});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
  try{
    assert.equal((await call('/documents')).status,401);
    const admin=await login('admin'),faculty=await login('faculty'),student=await login('student');
    const upload=async(cookie,previousId)=>{const f=new FormData();for(const [k,v] of Object.entries({title:'BDT notes',subject:'Big Data',department:'CSE',semester:'7',category:'Lecture notes',...(previousId?{previousId}:{})}))f.set(k,v);f.set('file',new Blob(['Study CouchDB views.'],{type:'text/plain'}),'notes.txt');return fetch(base+'/documents',{method:'POST',headers:{cookie},body:f});};
    assert.equal((await upload(student)).status,403);
    const r=await upload(faculty);assert.equal(r.status,201);const d=await r.json(),id=encodeURIComponent(d._id);
    assert.equal((await (await call('/documents',student)).json()).length,0);
    assert.equal((await call('/documents/'+id+'/download',student)).status,404);
    assert.equal((await call('/documents/'+id+'/review',faculty,{status:'approved'})).status,403);
    assert.equal((await call('/documents/'+id+'/review',admin,{status:'rejected'})).status,400);
    assert.equal((await call('/documents/'+id+'/review',admin,{status:'approved'})).status,200);
    assert.equal(await (await call('/documents/'+id+'/download',student)).text(),'Study CouchDB views.');
    assert.equal((await (await call('/documents?q=bdt&department=CSE',student)).json()).length,1);
    assert.equal((await (await call('/documents?q=unmatched',student)).json()).length,0);
    assert.equal((await (await call('/documents?q=.*',student)).json()).length,0);
    assert.equal((await (await call('/documents?status=pending',student)).json()).length,1);
    const r2=await upload(faculty,d._id);assert.equal(r2.status,201);const d2=await r2.json();assert.equal(d2.version,2);
    const visible=await (await call('/documents',student)).json();assert.equal(visible.length,1);assert.equal(visible[0].version,1);
    assert.equal((await (await call('/documents/'+id+'/versions',student)).json()).length,1);
    assert.equal((await call('/documents/'+encodeURIComponent(d2._id)+'/review',admin,{status:'rejected',remarks:'Add references'})).status,200);
    assert.equal((await (await call('/documents/'+id+'/versions',faculty)).json()).length,2);
    assert.equal((await call('/users',student,{email:'bad@college.edu'})).status,403);
    assert.equal((await call('/logout',student,{})).status,200);
    assert.equal((await call('/documents',student)).status,401);
    assert.equal((await call('/change-password',null,{currentPassword:'CollegeDemo123!',newPassword:'ChangedCollege123!',confirmPassword:'ChangedCollege123!'})).status,401);
    assert.equal((await call('/change-password',admin,{currentPassword:'WrongAdmin123!',newPassword:'ChangedCollege123!',confirmPassword:'ChangedCollege123!'})).status,403);
    for(const accountRole of ['faculty','student']) {
      const session=await login(accountRole),otherSession=await login(accountRole);
      const change=body=>call('/change-password',session,body);
      const body={currentPassword:'CollegeDemo123!',newPassword:'ChangedCollege123!',confirmPassword:'ChangedCollege123!'};
      assert.equal((await change({...body,currentPassword:'WrongPassword123!'})).status,403);
      assert.equal((await change({...body,newPassword:'short',confirmPassword:'short'})).status,400);
      assert.equal((await change({...body,confirmPassword:'MismatchPassword123!'})).status,400);
      assert.equal((await change({...body,newPassword:body.currentPassword,confirmPassword:body.currentPassword})).status,400);
      assert.equal((await change(body)).status,200);
      assert.equal((await call('/me',session)).status,401);
      assert.equal((await call('/me',otherSession)).status,401);
      const email=accountRole+'@college.edu';
      assert.equal((await call('/login',null,{email,password:'CollegeDemo123!'})).status,401);
      const fresh=await call('/login',null,{email,password:body.newPassword});assert.equal(fresh.status,200);
      const record=await store.get('user:'+email);assert.notEqual(record.password,body.newPassword);assert.match(record.password,/^[a-f0-9]{32}:[a-f0-9]{128}$/);assert.ok(record.passwordChangedAt);
      assert.equal((await call('/me',fresh.headers.get('set-cookie').split(';')[0])).status,200);
    }
    const facultyLogin=await call('/login',null,{email:'faculty@college.edu',password:'ChangedCollege123!'});
    const facultyCookie=facultyLogin.headers.get('set-cookie').split(';')[0];let limited;
    for(let i=0;i<11;i++) limited=await call('/change-password',facultyCookie,{currentPassword:'IncorrectCurrent123!',newPassword:'AnotherPassword123!',confirmPassword:'AnotherPassword123!'});
    assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);assert.match((await limited.json()).error,/Too many attempts/);
    const studentLogin=await call('/login',null,{email:'student@college.edu',password:'ChangedCollege123!'});
    assert.equal((await call('/change-password',studentLogin.headers.get('set-cookie').split(';')[0],{currentPassword:'IncorrectCurrent123!',newPassword:'AnotherPassword123!',confirmPassword:'AnotherPassword123!'})).status,403);
    const studentCookie=studentLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await call('/users',studentCookie)).status,403);
    assert.equal((await call('/users/'+encodeURIComponent('user:faculty@college.edu')+'/reset-password',studentCookie,{})).status,403);
    const accounts=await (await call('/users',admin)).json();assert.equal(accounts.length,2);assert.ok(accounts.every(a=>!('password' in a)));
    assert.equal((await call('/users/'+encodeURIComponent('user:admin@college.edu')+'/reset-password',admin,{})).status,403);
    for(const accountRole of ['faculty','student']) {
      const id='user:'+accountRole+'@college.edu',email=accountRole+'@college.edu';
      const before=await call('/login',null,{email,password:'ChangedCollege123!'});const previousCookie=before.headers.get('set-cookie').split(';')[0];
      assert.equal((await call('/users/'+encodeURIComponent(id)+'/reset-password',admin,{})).status,200);
      assert.equal((await call('/me',previousCookie)).status,401);
      assert.equal((await call('/login',null,{email,password:'ChangedCollege123!'})).status,401);
      const loginReset=await call('/login',null,{email,password:'Test@123'});assert.equal(loginReset.status,200);
      const resetUser=await store.get(id);assert.notEqual(resetUser.password,'Test@123');assert.equal(resetUser.passwordResetBy,'user:admin@college.edu');
      assert.equal((await call('/change-password',loginReset.headers.get('set-cookie').split(';')[0],{currentPassword:'Test@123',newPassword:'Test@456',confirmPassword:'Test@456'})).status,200);
    }
    assert.equal((await call('/users',admin,{email:'policy@college.edu',name:'Policy test',role:'student',password:'password'})).status,400);
    assert.equal((await call('/users',admin,{email:'policy@college.edu',name:'Policy test',role:'student',password:'Test@123'})).status,201);
    const deletionCall=(path,cookie)=>fetch(base+path,{method:'DELETE',headers:cookie?{cookie}:{}});
    const activeFaculty=await call('/login',null,{email:'faculty@college.edu',password:'Test@456'}),activeStudent=await call('/login',null,{email:'student@college.edu',password:'Test@456'});
    const facultySession=activeFaculty.headers.get('set-cookie').split(';')[0],studentSession=activeStudent.headers.get('set-cookie').split(';')[0];
    assert.equal((await deletionCall('/documents/'+id,facultySession)).status,403);
    assert.equal((await deletionCall('/documents/'+id,studentSession)).status,403);
    assert.equal((await deletionCall('/users/'+encodeURIComponent('user:faculty@college.edu'),studentSession)).status,403);
    assert.equal((await deletionCall('/users/'+encodeURIComponent('user:admin@college.edu'),admin)).status,403);
    for(const [accountRole,session] of [['faculty',facultySession],['student',studentSession]]) {
      const accountId='user:'+accountRole+'@college.edu';
      assert.equal((await deletionCall('/users/'+encodeURIComponent(accountId),admin)).status,200);
      assert.equal((await call('/me',session)).status,401);
      assert.equal((await call('/login',null,{email:accountRole+'@college.edu',password:'Test@456'})).status,401);
      assert.equal((await call('/users/'+encodeURIComponent(accountId)+'/reset-password',admin,{})).status,404);
      await assert.rejects(store.get(accountId),e=>e.status===404);
      assert.ok(await store.deletedRevision(accountId));
    }
    assert.equal((await (await call('/users',admin)).json()).length,1);
    assert.equal((await call('/documents/'+id+'/download',admin)).status,200);
    const deletedDocument=await deletionCall('/documents/'+id,admin);assert.equal(deletedDocument.status,200);assert.equal((await deletedDocument.json()).deletedVersions,2);
    for(const documentId of [d._id,d2._id]) {
      assert.equal((await call('/documents/'+encodeURIComponent(documentId)+'/download',admin)).status,404);
      assert.equal((await call('/documents/'+encodeURIComponent(documentId)+'/versions',admin)).status,404);
      await assert.rejects(store.get(documentId),e=>e.status===404);
    }
    assert.equal((await (await call('/documents',admin)).json()).length,0);
    await createApp(store);await assert.rejects(store.get('user:faculty@college.edu'),e=>e.status===404);
    for(const accountRole of ['faculty','student']){
      const email=accountRole+'@college.edu';
      const recreated=await call('/users',admin,{email,name:'Recreated '+accountRole,role:accountRole,password:'Test@456'});assert.equal(recreated.status,201,JSON.stringify(await recreated.json()));
      assert.equal((await call('/login',null,{email,password:'Test@456'})).status,200);
      assert.equal((await call('/users',admin,{email,name:'Duplicate',role:accountRole,password:'Test@456'})).status,409);
    }
    assert.equal((await call('/me',facultySession)).status,401);
    assert.equal((await call('/me',studentSession)).status,401);
    // Previously soft-deleted accounts are migrated and can also be recreated.
    const legacy=await store.get('user:policy@college.edu');
    await store.put({...legacy,password:null,deletedAt:new Date().toISOString()});await createApp(store);
    await assert.rejects(store.get(legacy._id),e=>e.status===404);
    assert.equal((await call('/users',admin,{email:'policy@college.edu',name:'Recreated legacy',role:'student',password:'Test@123'})).status,201);
    assert.equal((await call('/change-password',admin,{currentPassword:'AdminDemo123!',newPassword:'Admin@12',confirmPassword:'Admin@12'})).status,200);
    assert.equal((await call('/me',admin)).status,401);
    assert.equal((await call('/login',null,{email:'admin@college.edu',password:'Admin@12'})).status,200);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(process.env.TEST_COUCHDB==='true') await store.request(store.db,'DELETE');}
});
