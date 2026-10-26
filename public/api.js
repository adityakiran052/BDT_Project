export async function readApiResponse(response) {
  const body=await response.text();let data;
  try {data=JSON.parse(body);} catch {
    if(response.status===429) throw new Error('Too many attempts. Please wait and try again.');
    throw new Error(response.ok?'The server returned an invalid response. Please refresh and try again.':'Request failed. Please refresh and try again.');
  }
  if(!response.ok) throw new Error(data.error||'Request failed');
  return data;
}
