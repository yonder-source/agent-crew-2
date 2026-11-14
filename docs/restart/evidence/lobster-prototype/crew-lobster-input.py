import json,subprocess
base=['docker','exec','crew-lobster-probe','node','dist/index.js','gateway','call','tools.invoke','--json','--params']
def call(args):
 p=subprocess.run(base+[json.dumps({'name':'lobster','args':args})],capture_output=True,text=True,timeout=45); return json.loads(p.stdout)
def details(v): return v.get('output',{}).get('details',{})
r=details(call({'action':'run','pipeline':"ask --prompt 'Review task result?'"})); print('checkpoint',r.get('status')); token=r['requiresInput']['resumeToken']
bad=call({'action':'resume','token':token,'responseJson':'{"decision":"invalid"}'}); print('invalid_response_ok',bad.get('ok'),'error',bad.get('error',{}).get('code'))
good=call({'action':'resume','token':token,'responseJson':'{"decision":"approve","feedback":"synthetic result accepted"}'}); print('valid_response',json.dumps(details(good)))
