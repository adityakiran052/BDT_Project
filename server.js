import express from 'express';
import multer from 'multer';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {randomUUID,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {MemoryStore,CouchStore} from './store.js';
import {passwordPolicyError} from './public/password-policy.js';
import {previewAccountImport} from './account-import.js';
import {registerAchievementRoutes} from './achievements.js';
const hash=p=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex');};
const verify=(p,h)=>{const [s,v]=h.split(':');return timingSafeEqual(scryptSync(p,s,64),Buffer.from(v,'hex'));};
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const safe=d=>{const {_attachments,_rev,...rest}=d;return rest;};
const profile=u=>({id:u._id,name:u.name,email:u.email,role:u.role});
const limitResponse=(req,res)=>{
  const seconds=Math.max(1,Math.ceil(((req.rateLimit?.resetTime?.getTime()||Date.now()+60000)-Date.now())/1000));
  res.set('Retry-After',String(seconds)).status(429).json({error:`Too many attempts. Try again in ${Math.ceil(seconds/60)} minute(s).`,retryAfterSeconds:seconds});
};
export async function createApp(store) {
  await store.init();
  // Convert accounts deleted by the previous version into normal CouchDB deletions.
  for(const user of await store.query({type:'user'})) if(user.deletedAt)await store.remove(user);
  const email=process.env.ADMIN_EMAIL||'admin@college.edu';
  if(!(await store.query({type:'user',email})).length) { const p=process.env.ADMIN_PASSWORD; if(passwordPolicyError(p)) throw new Error('ADMIN_PASSWORD: '+passwordPolicyError(p)); await store.put({_id:'user:'+email,type:'user',email,name:'College administrator',role:'admin',password:hash(p)}); }
  if(process.env.DEMO_SEED==='true') for(const role of ['faculty','student']) { const e=role+'@college.edu'; if(!(await store.query({type:'user',email:e})).length && !await store.deletedRevision('user:'+e)) await store.put({_id:'user:'+e,type:'user',email:e,name:role==='faculty'?'Dr. Asha Rao':'Student account',role,password:hash('CollegeDemo123!')}); }
  const app=express(),sessions=new Map();
  app.use(helmet()); app.use(express.json({limit:'32kb'}));
  app.use('/api',rateLimit({windowMs:60000,limit:150,handler:limitResponse}));
  app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
  const cookie=req=>req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);
  const auth=async(req,res,next)=>{try {const token=cookie(req),s=sessions.get(token);if(!s||s.expires<Date.now()) {sessions.delete(token);fail(401,'Please sign in');} req.user=await store.get(s.id);if(req.user.deletedAt){sessions.delete(token);fail(401,'This account has been deleted');}if(s.passwordHash!==req.user.password){sessions.delete(token);fail(401,'Your password changed. Please sign in again');}next();}catch(e){next(e);}};
  const role=(...roles)=>(req,res,next)=>roles.includes(req.user.role)?next():next(Object.assign(new Error('Access denied'),{status:403}));
  const readable=(u,d)=>u.role==='admin'||d.status==='approved'||(u.role==='faculty'&&d.owner===u._id);
  const text=(v,label,max=120)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max) fail(400,`Invalid ${label}`);return v.trim();};
  app.post('/api/login',rateLimit({windowMs:900000,limit:30,handler:limitResponse}),async(req,res)=>{const {email,password}=req.body;if(typeof email!=='string'||typeof password!=='string'||password.length>200) fail(400,'Invalid login');const [u]=await store.query({type:'user',email:email.toLowerCase().trim()});if(!u||u.deletedAt||!verify(password,u.password)) fail(401,'Incorrect email or password');const token=randomBytes(32).toString('hex');sessions.set(token,{id:u._id,passwordHash:u.password,expires:Date.now()+8*3600000});res.cookie('session',token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:8*3600000});res.json(profile(u));});
  app.post('/api/logout',auth,(req,res)=>{sessions.delete(cookie(req));res.clearCookie('session');res.json({ok:true});});
  const passwordChangeLimiter=rateLimit({windowMs:900000,limit:10,keyGenerator:req=>req.user._id,skipSuccessfulRequests:true,handler:limitResponse});
  app.post('/api/change-password',auth,role('admin','faculty','student'),passwordChangeLimiter,async(req,res)=>{
    const {currentPassword,newPassword,confirmPassword}=req.body;
    if(typeof currentPassword!=='string'||currentPassword.length>200) fail(400,'Enter your current password');
    const policyError=passwordPolicyError(newPassword);if(policyError) fail(400,policyError);
    if(newPassword!==confirmPassword) fail(400,'New passwords do not match');
    if(!verify(currentPassword,req.user.password)) fail(403,'Current password is incorrect');
    if(currentPassword===newPassword) fail(400,'Choose a different new password');
    await store.put({...req.user,password:hash(newPassword),passwordChangedAt:new Date().toISOString()});
    for(const [token,session] of sessions) if(session.id===req.user._id) sessions.delete(token);
    res.clearCookie('session');res.json({ok:true});
  });
  app.get('/api/me',auth,(req,res)=>res.json({...profile(req.user),demo:store instanceof MemoryStore}));
  const importUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:2},fileFilter:(req,file,callback)=>callback(/\.xlsx$/i.test(file.originalname)?null:Object.assign(new Error('Upload an Excel .xlsx file.'),{status:400}),/\.xlsx$/i.test(file.originalname))}).single('file');
  const importFile=(req,res,next)=>importUpload(req,res,error=>next(error?.code==='LIMIT_FILE_SIZE'?Object.assign(new Error('Excel file must be smaller than 5 MB.'),{status:413}):error));
  app.post('/api/users/import/preview',auth,role('admin'),importFile,async(req,res)=>{
    if(!req.file)fail(400,'Choose an Excel .xlsx file');
    res.json(await previewAccountImport(store,req.file.buffer));
  });
  app.post('/api/users/import',auth,role('admin'),importFile,async(req,res)=>{
    if(!req.file)fail(400,'Choose an Excel .xlsx file');
    if(!['student','faculty'].includes(req.body.role))fail(400,'Choose Student or Faculty');
    const result=await previewAccountImport(store,req.file.buffer);let created=0,failed=0;
    for(const row of result.rows){
      if(row.status!=='ready')continue;
      try{
        await store.put({_id:'user:'+row.email,type:'user',name:row.name,email:row.email,role:req.body.role,password:hash('Test@123'),createdBy:req.user._id,createdAt:new Date().toISOString()});
        row.status='created';row.message='Account created';created++;
      }catch(e){row.status=e.status===409?'skipped':'failed';row.message=e.status===409?'Account already exists; skipped.':'Account could not be created. Retry this row.';if(row.status==='failed')failed++;}
      await new Promise(resolve=>setImmediate(resolve));
    }
    res.json({...result,ready:0,created,failed,skipped:result.rows.filter(row=>row.status==='skipped').length});
  });
  app.delete('/api/users/:id',auth,role('admin'),async(req,res)=>{
    const target=await store.get(req.params.id);
    if(target.type!=='user'||target.deletedAt||!['faculty','student'].includes(target.role))fail(403,'Only active faculty and student accounts can be deleted');
    await store.remove(target);
    for(const [token,session] of sessions)if(session.id===target._id)sessions.delete(token);
    res.json({ok:true});
  });
  app.delete('/api/documents/:id',auth,role('admin'),async(req,res)=>{
    const document=await store.get(req.params.id);if(document.type!=='document')fail(404,'Document not found');
    const versions=await store.query({type:'document',groupId:document.groupId});
    for(const version of versions)await store.remove(version);
    res.json({ok:true,deletedVersions:versions.length});
  });
  app.get('/api/users',auth,role('admin'),async(req,res)=>{res.json((await store.query({type:'user'})).filter(u=>!u.deletedAt&&['faculty','student'].includes(u.role)).map(profile).sort((a,b)=>a.email.localeCompare(b.email)));});
  app.post('/api/users/:id/reset-password',auth,role('admin'),rateLimit({windowMs:60000,limit:30,keyGenerator:req=>req.user._id,handler:limitResponse}),async(req,res)=>{
    const target=await store.get(req.params.id);
    if(target.type!=='user'||target.deletedAt||!['faculty','student'].includes(target.role)) fail(403,'Only faculty and student passwords can be reset');
    await store.put({...target,password:hash('Test@123'),passwordChangedAt:new Date().toISOString(),passwordResetBy:req.user._id});
    for(const [token,session] of sessions) if(session.id===target._id) sessions.delete(token);
    passwordChangeLimiter.resetKey(target._id);res.json({ok:true});
  });
  app.post('/api/users',auth,role('admin'),async(req,res)=>{const email=text(req.body.email,'email').toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,'Invalid email');const name=text(req.body.name,'name');const password=req.body.password;const policyError=passwordPolicyError(password);if(policyError) fail(400,policyError);if(!['student','faculty'].includes(req.body.role)) fail(400,'Choose student or faculty');if((await store.query({type:'user',email})).length) fail(409,'Email already exists');const id='user:'+email;res.status(201).json(profile(await store.put({_id:id,type:'user',email,name,role:req.body.role,password:hash(password)})));});
  app.get('/api/documents',auth,async(req,res)=>{const filters={type:'document'};for(const k of ['department','category','semester']) if(req.query[k]) filters[k]=text(req.query[k],k);const q=String(req.query.q||'').toLowerCase().slice(0,120);if(req.query.scope==='mine') filters.owner=req.user._id;if(req.query.status) filters.status=text(req.query.status,'status');let docs=(await store.search(req.user,filters,q)).filter(d=>readable(req.user,d));const latest=new Map();for(const d of docs) if(!latest.has(d.groupId)||latest.get(d.groupId).version<d.version) latest.set(d.groupId,d);res.json([...latest.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(safe));});
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:10}});
  app.post('/api/documents',auth,role('faculty'),upload.single('file'),async(req,res)=>{
    if(!req.file) fail(400,'Choose a file');const b=req.file.buffer,name=req.file.originalname.replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,150);const ext=name.split('.').pop().toLowerCase();const mime={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',txt:'text/plain'}[ext];if(!mime) fail(400,'Use PDF, DOCX, PPTX or TXT');if(ext==='pdf'&&b.subarray(0,5).toString()!=='%PDF-') fail(400,'Invalid PDF file');if(['docx','pptx'].includes(ext)&&b.subarray(0,2).toString()!=='PK') fail(400,'Invalid Office file');
    const title=text(req.body.title,'title'),department=text(req.body.department,'department'),subject=text(req.body.subject,'subject'),category=text(req.body.category,'category'),semester=text(req.body.semester,'semester');if(!['Lecture notes','Syllabus','Notice','Previous-year paper','Project report'].includes(category)||!/^([1-8])$/.test(semester)) fail(400,'Invalid category or semester');
    let groupId=randomUUID(),version=1;if(req.body.previousId) {const prev=await store.get(req.body.previousId);if(prev.type!=='document'||prev.owner!==req.user._id) fail(403,'Only the original uploader can submit a revision');groupId=prev.groupId;version=Math.max(...(await store.query({type:'document',groupId})).map(d=>d.version))+1;}
    const d={_id:`document:${groupId}:${version}`,type:'document',groupId,version,title,department,subject,category,semester,description:String(req.body.description||'').slice(0,2000),owner:req.user._id,uploader:req.user.name,status:'pending',createdAt:new Date().toISOString(),filename:name,mime,size:b.length,_attachments:{file:{content_type:mime,data:b.toString('base64')}}};
    res.status(201).json(safe(await store.put(d)));
  });
  app.get('/api/documents/:id/versions',auth,async(req,res)=>{const d=await store.get(req.params.id);if(d.type!=='document'||!readable(req.user,d)) fail(404,'Document not found');res.json((await store.query({type:'document',groupId:d.groupId})).filter(v=>readable(req.user,v)).sort((a,b)=>b.version-a.version).map(safe));});
  app.get('/api/documents/:id/download',auth,async(req,res)=>{const d=await store.get(req.params.id);if(d.type!=='document'||!readable(req.user,d)) fail(404,'Document not found');res.attachment(d.filename);res.type(d.mime);res.send(await store.file(d));});
  app.post('/api/documents/:id/review',auth,role('admin'),async(req,res)=>{if(!['approved','rejected'].includes(req.body.status)) fail(400,'Invalid decision');const d=await store.get(req.params.id);if(d.type!=='document'||d.status!=='pending') fail(409,'Only pending documents can be reviewed');const remarks=String(req.body.remarks||'').trim().slice(0,2000);if(req.body.status==='rejected'&&!remarks) fail(400,'Add a reason for rejection');res.json(safe(await store.put({...d,status:req.body.status,remarks,reviewedBy:req.user._id,reviewedAt:new Date().toISOString()})));});
  registerAchievementRoutes(app,{store,auth,role});
  app.use(express.static(fileURLToPath(new URL('./public',import.meta.url))));
  app.use((err,req,res,next)=>{const status=err.code==='LIMIT_FILE_SIZE'?413:err instanceof multer.MulterError?400:(err.status>=400&&err.status<500?err.status:500);if(status===500) console.error(err.message);res.status(status).json({error:status===500?'Server error. Check database connection.':err.code==='LIMIT_FILE_SIZE'?'File must be smaller than 10 MB':err.message});});
  return app;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {const store=process.env.STORE==='memory'?new MemoryStore():new CouchStore();const app=await createApp(store);app.listen(Number(process.env.PORT)||3000,'127.0.0.1',()=>console.log(`COLLEDOCS: http://localhost:${process.env.PORT||3000} (${process.env.STORE||'couchdb'})`));}
