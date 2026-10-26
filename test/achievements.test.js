import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.js';
import {MemoryStore,CouchStore} from '../store.js';
import {achievementCategories} from '../public/achievement-options.js';

test('students share achievement attachments and faculty view profile, evidence and other achievements',async()=>{
  process.env.ADMIN_PASSWORD='AdminDemo123!';process.env.DEMO_SEED='true';
  if(process.env.TEST_COUCHDB==='true')process.env.COUCHDB_DB='colledocs_achievements_test_'+Date.now();
  const store=process.env.TEST_COUCHDB==='true'?new CouchStore():new MemoryStore();
  const server=(await createApp(store)).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const request=(path,cookie,body,method)=>fetch(base+path,{method:method||(body?'POST':'GET'),headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  async function login(email,password){const result=await request('/login',null,{email,password});assert.equal(result.status,200);return result.headers.get('set-cookie').split(';')[0];}
  const pdf=Buffer.from('%PDF-1.4\nAchievement evidence'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');
  async function upload(cookie,fields={},file=pdf,filename='certificate.pdf'){
    const body=new FormData();for(const[key,value]of Object.entries({title:'Hackathon first place',category:'Competition or hackathon awards',description:'Built a college document repository and won first place.',achievedOn:'2026-10-20',issuer:'College innovation club',distinction:'First prize',referenceUrl:'https://example.edu/results',...fields}))body.set(key,value);
    body.set('file',new Blob([file]),filename);return fetch(base+'/achievements',{method:'POST',headers:{cookie},body});
  }
  try{
    assert.equal(achievementCategories.length,9);assert.equal((await request('/achievements')).status,401);
    const admin=await login('admin@college.edu','AdminDemo123!'),faculty=await login('faculty@college.edu','CollegeDemo123!'),student=await login('student@college.edu','CollegeDemo123!');
    assert.equal((await request('/users',admin,{name:'Other Student',email:'other@college.edu',role:'student',password:'Test@123'})).status,201);
    const other=await login('other@college.edu','Test@123');
    assert.equal((await upload(faculty)).status,403);assert.equal((await upload(admin)).status,403);
    assert.equal((await request('/student-profile',faculty)).status,403);
    assert.equal((await request('/student-profile',student,{semester:'9'},'PUT')).status,400);
    const profile={rollNumber:'CSE-001',department:'CSE',programme:'BTech',yearOfStudy:'4',semester:'7',division:'A',graduationYear:'2027',role:'admin',email:'spoof@college.edu'};
    const saved=await request('/student-profile',student,profile,'PUT');assert.equal(saved.status,200);assert.equal((await saved.json()).email,'student@college.edu');
    assert.equal((await store.get('user:student@college.edu')).role,'student');
    assert.equal((await upload(student,{category:'Invalid category'})).status,400);
    assert.equal((await upload(student,{achievedOn:'2026-02-31'})).status,400);
    assert.equal((await upload(student,{referenceUrl:'javascript:alert(1)'})).status,400);
    assert.equal((await upload(student,{},Buffer.from('<html>not a PDF</html>'))).status,400);
    assert.equal((await upload(student,{},Buffer.from('<svg></svg>'),'proof.svg')).status,400);
    const first=await upload(student,{studentId:'user:other@college.edu'});assert.equal(first.status,201);const achievement=await first.json();assert.equal(achievement.studentId,'user:student@college.edu');assert.ok(!achievement._attachments);
    const second=await upload(student,{title:'Gold medal',category:'Medals and trophies',description:'Gold medal in the college sports competition.'},png,'medal.png');assert.equal(second.status,201);const secondAchievement=await second.json();
    const id=encodeURIComponent(achievement._id);
    assert.equal((await request('/achievements/'+id,null,null,'DELETE')).status,401);
    assert.equal((await request('/achievements/'+id,student,null,'DELETE')).status,403);
    assert.equal((await request('/achievements/'+id,faculty,null,'DELETE')).status,403);
    assert.equal((await request('/achievements/'+encodeURIComponent('user:student@college.edu'),admin,null,'DELETE')).status,404);
    assert.equal((await (await request('/achievements',student)).json()).length,2);
    assert.equal((await (await request('/achievements',other)).json()).length,0);
    assert.equal((await request('/achievements/'+id,other)).status,404);
    assert.equal((await request('/achievements/'+id+'/file',other)).status,404);
    assert.equal((await request('/achievements/'+id+'/file')).status,401);
    const detail=await (await request('/achievements/'+id,faculty)).json();assert.equal(detail.student.name,'Student account');assert.equal(detail.student.profile.department,'CSE');assert.equal(detail.student.profile.rollNumber,'CSE-001');assert.equal(detail.otherAchievements.length,1);assert.equal(detail.otherAchievements[0]._id,secondAchievement._id);assert.equal(detail.accountActive,true);assert.ok(!JSON.stringify(detail).includes('password'));
    const evidence=await request('/achievements/'+id+'/file',faculty);assert.equal(evidence.status,200);assert.match(evidence.headers.get('content-type'),/application\/pdf/);assert.match(evidence.headers.get('content-disposition'),/^inline/);assert.deepEqual(Buffer.from(await evidence.arrayBuffer()),pdf);
    const download=await request('/achievements/'+encodeURIComponent(secondAchievement._id)+'/file?download=1',faculty);assert.match(download.headers.get('content-disposition'),/^attachment/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),png);
    assert.equal((await (await request('/achievements?q=STUDENT%20ACCOUNT',faculty)).json()).length,2);
    assert.equal((await (await request('/achievements?category='+encodeURIComponent('Medals and trophies'),faculty)).json()).length,1);
    await request('/student-profile',student,{...profile,department:'Computer Engineering'},'PUT');
    assert.equal((await (await request('/achievements/'+id,faculty)).json()).student.profile.department,'Computer Engineering');
    const foreignType=await request('/achievements/'+encodeURIComponent('user:student@college.edu'),faculty);assert.equal(foreignType.status,404);
    // A recreated email cannot read or claim the deleted student's submissions.
    assert.equal((await request('/users/'+encodeURIComponent('user:student@college.edu'),admin,null,'DELETE')).status,200);
    assert.equal((await request('/users',admin,{name:'Replacement Student',email:'student@college.edu',role:'student',password:'Test@123'})).status,201);
    const replacement=await login('student@college.edu','Test@123');assert.equal((await (await request('/achievements',replacement)).json()).length,0);assert.equal((await request('/achievements/'+id,replacement)).status,404);
    const oldDetail=await (await request('/achievements/'+id,faculty)).json();assert.equal(oldDetail.accountActive,false);assert.equal(oldDetail.student.name,'Student account');
    const deletedId=encodeURIComponent(secondAchievement._id);
    assert.equal((await request('/achievements/'+deletedId,admin,null,'DELETE')).status,200);
    assert.equal((await request('/achievements/'+deletedId,faculty)).status,404);
    assert.equal((await request('/achievements/'+deletedId+'/file',faculty)).status,404);
    assert.equal((await request('/achievements/'+deletedId+'/file?download=1',admin)).status,404);
    assert.equal((await (await request('/achievements/'+id,faculty)).json()).otherAchievements.length,0);
    assert.equal((await (await request('/achievements',admin)).json()).length,1);
    await assert.rejects(store.get(secondAchievement._id),error=>error.status===404);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(process.env.TEST_COUCHDB==='true')await store.request(store.db,'DELETE');}
});
