import ExcelJS from 'exceljs';

const invalid=message=>Object.assign(new Error(message),{status:400});
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeHeader=value=>value.toLowerCase().replace(/[^a-z]/g,'');
const emailHeaders=new Set(['email','emailid','emailaddress','mail','mailid','mailaddress','studentemail','facultyemail','emailpersonal','personalemail','emailaddresspersonal','personalemailaddress','emailofficial','officialemail','collegeemail','institutionalemail']);
const nameHeaders=[new Set(['firstname','fname','givenname']),new Set(['middlename','mname']),new Set(['lastname','lname','surname','familyname'])];
const fullHeaders=new Set(['name','fullname','studentname','facultyname','nameofstudent','nameoffaculty']);
function text(cell) {
  const value=cell.value;
  if(value===null||value===undefined)return '';
  if(typeof value==='object'){
    if(value.formula||value.sharedFormula)throw invalid('Use plain text instead of formulas in name and email cells.');
    if(value.richText)return value.richText.map(part=>part.text).join('').trim();
    if(value.text!==undefined)return String(value.text).trim();
    throw invalid('Name and email cells must contain text.');
  }
  return String(value).trim();
}
export async function parseAccountWorkbook(buffer) {
  const workbook=new ExcelJS.Workbook();
  try{await workbook.xlsx.load(buffer);}catch{throw invalid('Cannot read this workbook. Upload a valid, unencrypted .xlsx file.');}
  const sheet=workbook.worksheets[0];
  if(!sheet||!sheet.actualRowCount)throw invalid('The first worksheet is empty.');
  // Formatting can extend a worksheet thousands of rows beyond its actual data.
  const rows=[];sheet.eachRow(row=>{let populated=false;row.eachCell(cell=>{if(cell.value!==null&&cell.value!==undefined&&(typeof cell.value!=='string'||cell.value.trim()))populated=true;});if(populated)rows.push(row);});
  if(!rows.length)throw invalid('The first worksheet is empty.');
  const first=rows[0];
  const headers=[];first.eachCell((cell,column)=>{try{headers[column-1]=normalizeHeader(text(cell));}catch{headers[column-1]='';}});
  let emailColumn=headers.findIndex(header=>emailHeaders.has(header));
  const hasHeaders=emailColumn>=0;
  if(rows.length-(hasHeaders?1:0)>500)throw invalid('Use at most 500 populated account rows on the first worksheet. Blank and formatted-only rows do not count.');
  let nameColumns=[];
  if(hasHeaders){
    const full=headers.findIndex(header=>fullHeaders.has(header));
    if(full>=0)nameColumns=[full+1];
    else nameColumns=nameHeaders.map(aliases=>headers.findIndex(header=>aliases.has(header))).filter(index=>index>=0).map(index=>index+1);
    if(!nameColumns.length)throw invalid('Use Full Name or First Name / Middle Name / Last Name column headings.');
    emailColumn++;
  }else{
    // Headerless files: name column(s) precede the email column.
    const candidates=new Set();
    for(const row of rows.slice(0,20))row.eachCell((cell,column)=>{
      try{if(emailPattern.test(text(cell)))candidates.add(column);}catch{}
    });
    if(candidates.size>1)throw invalid('More than one email column found. Add Full Name and Email column headings.');
    emailColumn=[...candidates][0]||2;
    if(emailColumn<2)throw invalid('For a headerless sheet, place name columns before the email column.');
    nameColumns=Array.from({length:emailColumn-1},(_,i)=>i+1);
  }
  const seen=new Set(),results=[];
  for(const row of rows.slice(hasHeaders?1:0)){
    let name='',email='',error='';
    try{
      name=nameColumns.map(column=>text(row.getCell(column))).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
      email=text(row.getCell(emailColumn)).toLowerCase();
      if(!name||name.length>120)error='Full name must contain 1 to 120 characters.';
      else if(email.length>120||!emailPattern.test(email))error='Invalid email address.';
      else if(seen.has(email))error='Duplicate email in this workbook.';
      else seen.add(email);
    }catch(e){error=e.message;}
    results.push({row:row.number,name,email,status:error?'skipped':'ready',message:error||'Ready to create'});
  }
  if(!results.length)throw invalid('No account rows found below the headings.');
  return {worksheet:sheet.name,rows:results};
}
export async function previewAccountImport(store,buffer){
  const parsed=await parseAccountWorkbook(buffer);
  const existing=new Set((await store.query({type:'user'})).filter(user=>!user.deletedAt).map(user=>user.email));
  for(const row of parsed.rows)if(row.status==='ready'&&existing.has(row.email)){row.status='skipped';row.message='An account already exists for this email.';}
  return {...parsed,ready:parsed.rows.filter(row=>row.status==='ready').length};
}
