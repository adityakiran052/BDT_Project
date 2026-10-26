import {passwordPolicyError} from './password-policy.js';
export function passwordError({currentPassword,newPassword,confirmPassword}) {
  if(!currentPassword) return 'Enter your current password.';
  if(currentPassword.length>200) return 'Current password must be at most 200 characters.';
  const policyError=passwordPolicyError(newPassword);if(policyError) return policyError;
  if(newPassword!==confirmPassword) return 'New passwords do not match.';
  if(currentPassword===newPassword) return 'Choose a different new password.';
  return '';
}
export function setupPasswordForm({form,status,submit,onSuccess}) {
  form.noValidate=true;
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=form.querySelector('button[type="submit"], button:not([type])');
    if(button.disabled) return;
    const values=Object.fromEntries(new FormData(form));
    const error=passwordError(values);
    if(error) {status.textContent=error;return;}
    button.disabled=true;status.textContent='Saving your new password…';
    try {await submit(values);form.reset();status.textContent='';await onSuccess();}
    catch(error) {status.textContent=error.message||'Unable to save your password. Please try again.';}
    finally {button.disabled=false;}
  });
}
