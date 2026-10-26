export function passwordPolicyError(password) {
  if(typeof password!=='string'||password.length<8||password.length>200) return 'Password must contain 8 to 200 characters.';
  if(!/[A-Z]/.test(password)) return 'Password must contain at least one capital letter.';
  if(!/[0-9]/.test(password)) return 'Password must contain at least one number.';
  if(!/[\p{P}\p{S}]/u.test(password)) return 'Password must contain at least one special character.';
  return '';
}
