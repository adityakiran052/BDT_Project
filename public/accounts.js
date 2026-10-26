export function filterAccounts(accounts,query) {
  const q=query.trim().toLowerCase();
  return accounts.filter(account=>[account.name,account.email,account.role].some(value=>String(value||'').toLowerCase().includes(q)));
}
