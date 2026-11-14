import http from 'node:http';
http.createServer((req,res)=>{
 res.setHeader('content-type','application/json');
 if(req.url==='/jobs/job-47/issue' && req.method==='GET') return res.end(JSON.stringify({jobId:'job-47',repository:'example/repo',number:47,title:'SYNTHETIC-ISSUE-47',body:'Add a harmless test fixture.'}));
 if(req.url==='/jobs/job-47/pr' && req.method==='POST') return res.end(JSON.stringify({status:'draft',url:'https://example.invalid/example/repo/pull/48'}));
 res.statusCode=404; res.end(JSON.stringify({error:'unassigned_job'}));
}).listen(18796,'127.0.0.1');
