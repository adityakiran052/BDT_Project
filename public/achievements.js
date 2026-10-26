import {achievementCategories,studentProfileFields} from './achievement-options.js';

export function setupAchievements({api,json,getUser}){
  let viewGeneration=0,detailGeneration=0;
  const $=selector=>document.querySelector(selector);
  const node=(tag,text,className)=>{const element=document.createElement(tag);element.textContent=text;if(className)element.className=className;return element;};
  const page=document.createElement('section');page.id='achievements-page';page.hidden=true;
  page.innerHTML=`
    <div class="heading"><div><p class="eyebrow">STUDENT ACCOMPLISHMENTS</p><h1 id="ach-heading">My Achievements</h1><p id="ach-intro" class="muted"></p></div></div>
    <p id="ach-status" role="status" aria-live="polite"></p>
    <details id="ach-profile-panel" class="panel"><summary>My academic profile</summary><p class="muted">Save the details you want faculty to see with your achievements. All academic fields are optional.</p><p id="ach-profile-identity"></p><form id="ach-profile-form"><div id="ach-profile-fields" class="grid"></div><p id="ach-profile-status" role="status"></p><button class="primary">Save profile</button></form></details>
    <section id="ach-upload-panel" class="panel"><h2>Upload an achievement</h2><p class="muted">Share a certificate, award, publication, or photo of your medal or trophy with college faculty. PDF, PNG, JPG and WebP files up to 10 MB.</p>
    <form id="ach-upload-form"><div class="grid">
      <label>Achievement title<input name="title" maxlength="120" required></label>
      <label>Achievement category<select name="category" required></select></label>
      <label>Achievement date<input name="achievedOn" type="date"></label>
      <label>Issuing organization or event<input name="issuer" maxlength="120"></label>
      <label>Award or distinction<input name="distinction" maxlength="120" placeholder="For example: first place or gold medal"></label>
      <label>Publication or reference link<input name="referenceUrl" type="url" maxlength="500" placeholder="https://"></label>
    </div><label>Achievement description<textarea name="description" rows="4" maxlength="3000" required placeholder="Describe your achievement, your contribution and the outcome."></textarea></label>
    <label>Certificate, publication or image<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" required></label><p id="ach-upload-status" role="status" aria-live="polite"></p><button class="primary">Share achievement</button></form></section>
    <form id="ach-filters" class="filters"><input name="q" aria-label="Search achievements" placeholder="Search achievements or student name/email"><select name="category" aria-label="Filter achievements by category"><option value="">All achievement categories</option></select><button>Search achievements</button></form>
    <p id="ach-count" class="muted"></p><div id="ach-list" class="cards"></div>
    <dialog id="ach-dialog" aria-labelledby="ach-dialog-title"><div class="ach-dialog-head"><h2 id="ach-dialog-title">Achievement details</h2><button id="ach-close" type="button">Close details</button></div><div id="ach-details"></div></dialog>`;
  $('footer').before(page);
  const button=node('button','My Achievements');button.hidden=true;button.type='button';$('nav').append(button);
  const dialog=$('#ach-dialog');
  for(const select of [$('#ach-upload-form').elements.category,$('#ach-filters').elements.category])for(const category of achievementCategories)select.append(node('option',category));
  for(const [key,label]of Object.entries(studentProfileFields)){
    const wrapper=node('label',label),field=document.createElement('input');field.name=key;field.maxLength=120;
    if(['yearOfStudy','semester'].includes(key)){field.type='number';field.min='1';field.max='8';field.step='1';}
    if(key==='graduationYear'){field.type='number';field.min='1900';field.max='2199';field.step='1';}
    wrapper.append(field);$('#ach-profile-fields').append(wrapper);
  }
  const dismiss=()=>{detailGeneration++;if(dialog.open)dialog.close();$('#ach-details').replaceChildren();};
  $('#ach-close').onclick=dismiss;dialog.addEventListener('close',()=>$('#ach-details').replaceChildren());
  function fieldList(container,fields){const list=document.createElement('dl');list.className='ach-fields';for(const [label,value]of fields){list.append(node('dt',label),node('dd',value||'Not provided'));}container.append(list);}
  function fileLink(container,text,url,download=false){const link=node('a',text,'ach-file-link');link.href=url;link.target='_blank';link.rel='noopener noreferrer';if(download)link.removeAttribute('target');container.append(link);}
  function deleteControl(record){
    const container=node('div','','actions'),remove=node('button','Delete achievement'),status=node('p','');remove.type='button';status.setAttribute('role','status');container.append(remove,status);
    remove.onclick=async()=>{
      if(!confirm(`Delete "${record.title}" submitted by ${record.student.name}? The achievement and its attached file will be removed. This cannot be undone in COLLEDOCS.`))return;
      remove.disabled=true;status.textContent='Deleting achievement…';
      try{await api('/achievements/'+encodeURIComponent(record._id),{method:'DELETE'});dismiss();await load();$('#ach-status').textContent='Achievement and attached file deleted.';}
      catch(error){status.textContent=error.message;remove.disabled=false;}
    };
    return container;
  }
  async function detail(id){
    const generation=++detailGeneration;
    $('#ach-details').replaceChildren(node('p','Loading achievement details…'));if(!dialog.open)dialog.showModal();
    try{
      const {achievement,student,accountActive,otherAchievements}=await api('/achievements/'+encodeURIComponent(id));
      if(generation!==detailGeneration||!getUser())return;
      const body=$('#ach-details');body.replaceChildren();body.append(node('span',achievement.category,'tag'),node('h3',achievement.title),node('p',achievement.description,'ach-description'));
      if(getUser().role==='admin')body.append(deleteControl(achievement));
      fieldList(body,[['Achievement date',achievement.achievedOn],['Issuer / event',achievement.issuer],['Award / distinction',achievement.distinction],['Submitted on',new Date(achievement.createdAt).toLocaleString()]]);
      if(achievement.referenceUrl)fileLink(body,'Publication / reference link',achievement.referenceUrl);
      body.append(node('h3','Student details'));fieldList(body,[['Full name',student.name],['Email',student.email],...Object.entries(studentProfileFields).map(([key,label])=>[label,student.profile?.[key]])]);
      if(!accountActive)body.append(node('p','This student account is no longer active. These are the details recorded with the submission.','muted'));
      body.append(node('h3','Certificate or achievement image'));
      const url='/api/achievements/'+encodeURIComponent(id)+'/file',links=node('div','','actions');fileLink(links,'Open file',url);fileLink(links,'Download file',url+'?download=1',true);body.append(links);
      if(achievement.mime==='application/pdf'){const frame=document.createElement('iframe');frame.src=url;frame.title='Certificate or publication preview';frame.className='ach-preview';body.append(frame);}
      else{const image=document.createElement('img');image.src=url;image.alt='Uploaded evidence for '+achievement.title;image.className='ach-image';body.append(image);}
      body.append(node('h3','Other achievements by '+student.name));
      if(!otherAchievements.length)body.append(node('p','No other achievements submitted yet.','muted'));
      for(const other of otherAchievements){const item=node('button',other.title+' · '+other.category,'ach-other');item.type='button';item.onclick=()=>detail(other._id);body.append(item);}
    }catch(error){if(generation===detailGeneration)$('#ach-details').replaceChildren(node('p',error.message));}
  }
  async function load(){
    const generation=viewGeneration;
    const status=$('#ach-status');status.textContent='Loading achievements…';
    try{
      const params=new URLSearchParams(new FormData($('#ach-filters'))),records=await api('/achievements?'+params),list=$('#ach-list');if(generation!==viewGeneration||!getUser())return;list.replaceChildren();$('#ach-count').textContent=`${records.length} achievement(s)`;
      for(const record of records){const card=node('article','','card');card.append(node('span',record.category,'tag'));
        const title=node('h2',''),open=node('button',record.title,'ach-title');open.onclick=()=>detail(record._id);title.append(open);card.append(title,node('p',record.description.length>180?record.description.slice(0,180)+'…':record.description));
        card.append(node('p',record.student.name+' · '+record.student.email,'muted'),node('p',record.achievedOn||'Achievement date not provided','muted'));
        const view=node('button','View achievement');view.type='button';view.onclick=()=>detail(record._id);card.append(view);list.append(card);
        if(getUser().role==='admin')card.append(deleteControl(record));
      }
      if(!records.length)list.append(node('p',getUser().role==='student'?'No achievements yet. Share your first achievement above.':'No student achievements match this search.','empty'));
      status.textContent='';
    }catch(error){if(generation===viewGeneration)status.textContent=error.message;}
  }
  $('#ach-filters').onsubmit=event=>{event.preventDefault();load();};
  $('#ach-profile-form').onsubmit=async event=>{
    event.preventDefault();const submit=event.target.querySelector('button'),status=$('#ach-profile-status');submit.disabled=true;status.textContent='Saving profile…';
    try{await api('/student-profile',{...json(Object.fromEntries(new FormData(event.target))),method:'PUT'});status.textContent='Profile saved. Faculty can view these details with your achievements.';}
    catch(error){status.textContent=error.message;}finally{submit.disabled=false;}
  };
  $('#ach-upload-form').onsubmit=async event=>{
    event.preventDefault();const form=event.target,submit=form.querySelector('button'),status=$('#ach-upload-status');submit.disabled=true;status.textContent='Uploading achievement…';
    try{await api('/achievements',{method:'POST',body:new FormData(form)});form.reset();status.textContent='Achievement shared with faculty.';await load();}
    catch(error){status.textContent=error.message;}finally{submit.disabled=false;}
  };
  button.onclick=async()=>{
    const generation=++viewGeneration;
    const user=getUser();if(!user)return;
    $('#workspace').hidden=true;$('#password-panel').hidden=true;page.hidden=false;$('#ach-heading').textContent=user.role==='student'?'My Achievements':'Student Achievements';
    $('#ach-intro').textContent=user.role==='student'?'Keep your accomplishments together and share them with faculty.':'Explore student accomplishments, certificates and available academic details.';
    const own=user.role==='student';$('#ach-profile-panel').hidden=!own;$('#ach-upload-panel').hidden=!own;
    if(own){try{const student=await api('/student-profile');if(generation!==viewGeneration)return;$('#ach-profile-identity').textContent=student.name+' · '+student.email;for(const key of Object.keys(studentProfileFields))$('#ach-profile-form').elements[key].value=student.profile[key]||'';}catch(error){if(generation===viewGeneration)$('#ach-profile-status').textContent=error.message;}}
    if(generation!==viewGeneration)return;
    await load();
  };
  return {
    close(){viewGeneration++;dismiss();page.hidden=true;$('#workspace').hidden=!getUser();},
    setUser(user){viewGeneration++;dismiss();page.hidden=true;button.hidden=!user||!['student','faculty','admin'].includes(user.role);button.textContent=user?.role==='student'?'My Achievements':'Student Achievements';$('#ach-list').replaceChildren();$('#ach-filters').reset();$('#ach-upload-form').reset();$('#ach-profile-form').reset();for(const id of ['ach-profile-status','ach-upload-status','ach-status'])$('#'+id).textContent='';}
  };
}
