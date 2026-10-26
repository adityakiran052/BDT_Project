export function setupAccountImport({api,loadAccounts}){
  const $=selector=>document.querySelector(selector),form=$('#import-form'),file=$('#import-file'),role=$('#import-role'),create=$('#import-create'),status=$('#import-status');
  let preview=null,busy=false;
  const enable=()=>{create.disabled=busy||!preview?.ready||!role.value;};
  const clear=()=>{preview=null;$('#import-results').replaceChildren();status.textContent='';enable();};
  function show(result){
    const body=$('#import-results');body.replaceChildren();
    for(const row of result.rows){const tr=document.createElement('tr');for(const value of [row.row,row.name,row.email,row.message]){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}body.append(tr);}
  }
  file.onchange=clear;role.onchange=enable;
  $('#import-preview').onclick=async()=>{
    if(!file.files[0]){status.textContent='Choose an Excel .xlsx file first.';return;}
    busy=true;preview=null;enable();file.disabled=true;$('#import-preview').disabled=true;status.textContent='Reading workbook…';
    try{const data=new FormData();data.set('file',file.files[0]);preview=await api('/users/import/preview',{method:'POST',body:data});show(preview);status.textContent=`Worksheet: ${preview.worksheet}. ${preview.ready} ready; ${preview.rows.length-preview.ready} skipped. Choose Student or Faculty, then create accounts.`;}
    catch(error){$('#import-results').replaceChildren();status.textContent=error.message;}
    finally{busy=false;file.disabled=false;$('#import-preview').disabled=false;enable();}
  };
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||!preview?.ready||!role.value)return;
    busy=true;enable();file.disabled=true;role.disabled=true;$('#import-preview').disabled=true;status.textContent='Creating accounts… Please keep this page open.';
    try{const data=new FormData();data.set('file',file.files[0]);data.set('role',role.value);const result=await api('/users/import',{method:'POST',body:data});show(result);preview=null;status.textContent=`Created ${result.created}; skipped ${result.skipped}; failed ${result.failed}. Initial password: Test@123.`;await loadAccounts();}
    catch(error){status.textContent=error.message+' Preview again before retrying; accounts already created will be skipped.';preview=null;}
    finally{busy=false;file.disabled=false;role.disabled=false;$('#import-preview').disabled=false;enable();}
  };
}
