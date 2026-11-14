let input=''; for await (const chunk of process.stdin) input+=chunk;
const data=JSON.parse(input); const result=Array.isArray(data)?data[0]:data;
process.stdout.write(JSON.stringify({runId:result.runId,status:result.status,text:result.result.payloads[0].text}));
