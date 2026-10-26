import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {parseAccountWorkbook} from '../account-import.js';
import {createApp} from '../server.js';
import {CouchStore,MemoryStore} from '../store.js';
async function workbook(rows){const book=new ExcelJS.Workbook();book.addWorksheet('Accounts').addRows(rows);return Buffer.from(await book.xlsx.writeBuffer());}

test('Excel parser accepts full names, split names and headerless names',async()=>{
  const full=await parseAccountWorkbook(await workbook([['Full Name','E-mail ID','Department'],['Asha Rao','ASHA@college.edu','CSE']]));
  assert.equal(full.rows[0].name,'Asha Rao');assert.equal(full.rows[0].email,'asha@college.edu');
  const split=await parseAccountWorkbook(await workbook([['Roll No','Last Name','Email','Middle Name','First Name'],['5','Rao','asha@college.edu','','Asha'],['6','Kumar','kiran@college.edu','Mohan','Kiran']]));
  assert.equal(split.rows[0].name,'Asha Rao');assert.equal(split.rows[1].name,'Kiran Mohan Kumar');
  const noHeader=await parseAccountWorkbook(await workbook([['Asha','Devi','Rao','asha@college.edu'],['Kiran','','Kumar','kiran@college.edu']]));assert.equal(noHeader.rows[0].name,'Asha Devi Rao');assert.equal(noHeader.rows[1].name,'Kiran Kumar');
  const twoColumn=await parseAccountWorkbook(await workbook([['Asha Rao','asha@college.edu']]));assert.equal(twoColumn.rows[0].status,'ready');
});
test('Excel parser reports bad names, emails, duplicates, formulas and invalid files',async()=>{
  const result=await parseAccountWorkbook(await workbook([['Full Name','Email'],['Asha','asha@college.edu'],['Other','ASHA@college.edu'],['','missing@college.edu'],['Bad email','invalid'],[{formula:'"Formula Name"',result:'Formula Name'},'formula@college.edu']]));
  assert.deepEqual(result.rows.map(row=>row.status),['ready','skipped','skipped','skipped','skipped']);assert.match(result.rows[1].message,/Duplicate/);assert.match(result.rows[4].message,/formulas/);
  await assert.rejects(parseAccountWorkbook(Buffer.from('not an xlsx')),/valid, unencrypted/);
  await assert.rejects(parseAccountWorkbook(await workbook([['Name','Email']])),/No account rows/);
});
test('formatted empty rows and columns do not trigger account limits, and personal email headers work',async()=>{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Data');
  sheet.addRows([['First Name','Last Name','Email (personal)'],['Asha','Rao','asha@college.edu']]);
  sheet.getCell('BA1000').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFFFF'}};
  const parsed=await parseAccountWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  assert.equal(parsed.rows.length,1);assert.equal(parsed.rows[0].name,'Asha Rao');assert.equal(parsed.rows[0].email,'asha@college.edu');assert.equal(parsed.rows[0].status,'ready');
});
test('account limit counts real account rows, including a headerless sheet',async()=>{
  const rows=Array.from({length:500},(_,i)=>['Person '+i,`person${i}@college.edu`]);
  assert.equal((await parseAccountWorkbook(await workbook(rows))).rows.length,500);
  await assert.rejects(parseAccountWorkbook(await workbook([...rows,['Extra Person','extra@college.edu']])),/500 populated account rows/);
});
test('administrator imports students and faculty, skips duplicates, and saves hashed passwords',async()=>{
  process.env.ADMIN_PASSWORD='AdminDemo123!';process.env.DEMO_SEED='true';
  if(process.env.TEST_COUCHDB==='true')process.env.COUCHDB_DB='colledocs_import_test_'+Date.now();
  const store=process.env.TEST_COUCHDB==='true'?new CouchStore():new MemoryStore();
  const server=(await createApp(store)).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  async function login(email,password){return fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});}
  async function upload(path,cookie,buffer,role='student',filename='accounts.xlsx') {const form=new FormData();form.set('file',new Blob([buffer]),filename);form.set('role',role);return fetch(base+path,{method:'POST',headers:{cookie},body:form});}
  try{
    const admin=(await login('admin@college.edu','AdminDemo123!')).headers.get('set-cookie').split(';')[0];
    const student=(await login('student@college.edu','CollegeDemo123!')).headers.get('set-cookie').split(';')[0];
    const buffer=await workbook([['First Name','Middle Name','Last Name','Email'],['New','Middle','Student','new@college.edu'],['Duplicate','','Email','NEW@college.edu'],['Existing','','Student','student@college.edu'],['Invalid','','Email','wrong']]);
    assert.equal((await upload('/users/import',student,buffer)).status,403);
    assert.equal((await upload('/users/import/preview',student,buffer)).status,403);
    assert.equal((await upload('/users/import',admin,buffer,'admin')).status,400);
    assert.equal((await upload('/users/import/preview',admin,buffer,'student','accounts.xls')).status,400);
    const preview=await (await upload('/users/import/preview',admin,buffer)).json();assert.equal(preview.ready,1);await assert.rejects(store.get('user:new@college.edu'),e=>e.status===404);
    const created=await (await upload('/users/import',admin,buffer)).json();assert.equal(created.created,1);assert.equal(created.skipped,3);assert.equal(created.failed,0);
    const newUser=await store.get('user:new@college.edu');assert.equal(newUser.name,'New Middle Student');assert.equal(newUser.role,'student');assert.notEqual(newUser.password,'Test@123');assert.equal((await login(newUser.email,'Test@123')).status,200);
    assert.equal((await login('student@college.edu','CollegeDemo123!')).status,200);
    assert.equal((await (await upload('/users/import',admin,buffer)).json()).created,0);
    const facultyBuffer=await workbook([['Full Name','Email'],['New Faculty','teacher@college.edu']]);
    assert.equal((await (await upload('/users/import',admin,facultyBuffer,'faculty')).json()).created,1);assert.equal((await store.get('user:teacher@college.edu')).role,'faculty');assert.equal((await login('teacher@college.edu','Test@123')).status,200);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(process.env.TEST_COUCHDB==='true')await store.request(store.db,'DELETE');}
});
