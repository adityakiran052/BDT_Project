import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readApiResponse} from '../public/api.js';
test('API response reader handles plain-text and JSON rate-limit errors',async()=>{
  await assert.rejects(readApiResponse(new Response('Too many requests, please try again later.',{status:429})),/Too many attempts/);
  await assert.rejects(readApiResponse(new Response(JSON.stringify({error:'Too many attempts. Try again in 15 minute(s).'}),{status:429})),/15 minute/);
  await assert.rejects(readApiResponse(new Response('<html>Server error</html>',{status:500})),/Request failed/);
  assert.deepEqual(await readApiResponse(new Response('{"ok":true}')),{ok:true});
});
