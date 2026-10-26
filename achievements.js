import multer from 'multer';
import {randomUUID} from 'node:crypto';
import {achievementCategories,studentProfileFields} from './public/achievement-options.js';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const metadata=record=>{const {_attachments,_rev,...safe}=record;return safe;};
const studentDetails=user=>({id:user._id,name:user.name,email:user.email,profile:Object.fromEntries(Object.keys(studentProfileFields).map(key=>[key,typeof user.studentProfile?.[key]==='string'?user.studentProfile[key]:'']))});
function input(value,label,max,required=false){
  if(value===undefined||value===null)value='';
  if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim()))fail(400,`Invalid ${label}`);
  return value.trim();
}
export function registerAchievementRoutes(app,{store,auth,role}){
  // A separate account key prevents a recreated email from inheriting a deleted student's achievements.
  const studentKey=async(req,res,next)=>{try{
    if(req.user.role==='student'&&!req.user.accountKey){
      try{req.user=await store.put({...req.user,accountKey:randomUUID()});}
      catch(error){if(error.status!==409)throw error;req.user=await store.get(req.user._id);if(!req.user.accountKey)throw error;}
    }
    next();
  }catch(error){next(error);}};
  app.get('/api/student-profile',auth,role('student'),studentKey,(req,res)=>res.json(studentDetails(req.user)));
  app.put('/api/student-profile',auth,role('student'),studentKey,async(req,res)=>{
    const profile={};for(const [key,label]of Object.entries(studentProfileFields))profile[key]=input(req.body[key],label,120);
    if(profile.semester&&!/^[1-8]$/.test(profile.semester))fail(400,'Semester must be 1 to 8');
    if(profile.yearOfStudy&&!/^[1-8]$/.test(profile.yearOfStudy))fail(400,'Year of study must be 1 to 8');
    if(profile.graduationYear&&!/^(19|20|21)\d{2}$/.test(profile.graduationYear))fail(400,'Enter a valid graduation year');
    const user=await store.put({...req.user,studentProfile:profile,profileUpdatedAt:new Date().toISOString()});
    res.json(studentDetails(user));
  });
  const canRead=(user,record)=>record.type==='achievement'&&(user.role==='faculty'||user.role==='admin'||(user.role==='student'&&record.studentId===user._id&&record.studentKey===user.accountKey));
  const getAchievement=async(req)=>{const record=await store.get(req.params.id);if(!canRead(req.user,record))fail(404,'Achievement not found');return record;};
  app.delete('/api/achievements/:id',auth,role('admin'),async(req,res)=>{
    const record=await getAchievement(req);await store.remove(record);res.json({ok:true});
  });
  app.get('/api/achievements',auth,role('student','faculty','admin'),studentKey,async(req,res)=>{
    const selector={type:'achievement'};if(req.user.role==='student')selector.studentKey=req.user.accountKey;
    if(req.query.category){const category=input(req.query.category,'category',120);if(!achievementCategories.includes(category))fail(400,'Invalid achievement category');selector.category=category;}
    const query=input(req.query.q,'search',120).toLowerCase();
    let records=await store.query(selector);
    records=records.filter(record=>canRead(req.user,record)&&(!query||[record.title,record.description,record.issuer,record.student.name,record.student.email].some(value=>String(value||'').toLowerCase().includes(query))));
    res.json(records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(metadata));
  });
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:10}}).single('file');
  app.post('/api/achievements',auth,role('student'),studentKey,upload,async(req,res)=>{
    if(!req.file)fail(400,'Choose a certificate, publication or achievement image');
    const bytes=req.file.buffer,extension=req.file.originalname.split('.').pop().toLowerCase();
    const formats={pdf:{mime:'application/pdf',valid:bytes.subarray(0,5).toString()==='%PDF-'},png:{mime:'image/png',valid:bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))},jpg:{mime:'image/jpeg',valid:bytes[0]===255&&bytes[1]===216&&bytes[2]===255},jpeg:{mime:'image/jpeg',valid:bytes[0]===255&&bytes[1]===216&&bytes[2]===255},webp:{mime:'image/webp',valid:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'}};
    const format=formats[extension];if(!format||!format.valid)fail(400,'Upload a valid PDF, PNG, JPG or WebP file');
    const title=input(req.body.title,'achievement title',120,true),category=input(req.body.category,'category',120,true),description=input(req.body.description,'description',3000,true);
    if(!achievementCategories.includes(category))fail(400,'Invalid achievement category');
    const achievedOn=input(req.body.achievedOn,'achievement date',10);
    if(achievedOn&&(!/^\d{4}-\d{2}-\d{2}$/.test(achievedOn)||!Number.isFinite(Date.parse(achievedOn))||new Date(achievedOn).toISOString().slice(0,10)!==achievedOn))fail(400,'Enter a valid achievement date');
    const referenceUrl=input(req.body.referenceUrl,'reference link',500);if(referenceUrl){try{const url=new URL(referenceUrl);if(!['https:','http:'].includes(url.protocol))throw Error();}catch{fail(400,'Reference link must start with http:// or https://');}}
    const record={_id:'achievement:'+randomUUID(),type:'achievement',title,category,description,achievedOn,issuer:input(req.body.issuer,'issuer or organizer',120),distinction:input(req.body.distinction,'award or distinction',120),referenceUrl,studentId:req.user._id,studentKey:req.user.accountKey,student:studentDetails(req.user),createdAt:new Date().toISOString(),filename:req.file.originalname.replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,150),mime:format.mime,size:bytes.length,_attachments:{file:{content_type:format.mime,data:bytes.toString('base64')}}};
    res.status(201).json(metadata(await store.put(record)));
  });
  app.get('/api/achievements/:id',auth,role('student','faculty','admin'),studentKey,async(req,res)=>{
    const record=await getAchievement(req);let student=record.student,accountActive=false;
    try{const user=await store.get(record.studentId);if(user.type==='user'&&user.role==='student'&&!user.deletedAt&&user.accountKey===record.studentKey){student=studentDetails(user);accountActive=true;}}
    catch(error){if(error.status!==404)throw error;}
    const otherAchievements=(await store.query({type:'achievement',studentKey:record.studentKey})).filter(other=>other._id!==record._id&&canRead(req.user,other)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(metadata);
    res.json({achievement:metadata(record),student,accountActive,otherAchievements});
  });
  app.get('/api/achievements/:id/file',auth,role('student','faculty','admin'),studentKey,async(req,res)=>{
    const record=await getAchievement(req);
    res.type(record.mime);if(req.query.download==='1')res.attachment(record.filename);else res.set('Content-Disposition',`inline; filename="${record.filename}"`);
    res.send(await store.file(record));
  });
}
