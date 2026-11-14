import http from 'node:http';
const server=http.createServer((req,res)=>{
 if(req.url==='/v1/models'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({object:'list',data:[{id:'mock-coder',object:'model'}]}));}
 if(req.url!='/v1/chat/completions'){res.writeHead(404);return res.end();}
 let input='';req.on('data',c=>input+=c);req.on('end',()=>{
  const body=JSON.parse(input), msg='Synthetic coding complete: commit abc123, tests passed.';
  if(body.stream){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});for(const d of [{role:'assistant',content:msg},{}])res.write('data: '+JSON.stringify({id:'chatcmpl-probe',object:'chat.completion.chunk',created:1,model:'mock-coder',choices:[{index:0,delta:d,finish_reason:d.role?null:'stop'}]})+'\n\n');return res.end('data: [DONE]\n\n');}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'chatcmpl-probe',object:'chat.completion',created:1,model:'mock-coder',choices:[{index:0,message:{role:'assistant',content:msg},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));
 });
});server.listen(18795,'127.0.0.1');
