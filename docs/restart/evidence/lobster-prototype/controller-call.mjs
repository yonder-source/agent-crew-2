const action=process.argv[2];
const url=action==='issue'?'http://127.0.0.1:18796/jobs/job-47/issue':'http://127.0.0.1:18796/jobs/job-47/pr';
let payload='';for await (const c of process.stdin) payload+=c;
const response=await fetch(url,action==='issue'?{}:{method:'POST',headers:{'content-type':'application/json'},body:payload});
if(!response.ok) throw new Error(`controller_status_${response.status}`);
process.stdout.write(JSON.stringify(await response.json()));
