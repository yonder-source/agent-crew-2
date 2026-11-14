import json, subprocess
base=['docker','exec','crew-lobster-probe','node','dist/index.js','gateway','call','tools.invoke','--json','--params']
def call(args):
 p=subprocess.run(base+[json.dumps({'name':'lobster','args':args})],capture_output=True,text=True,timeout=45)
 try: return json.loads(p.stdout)
 except: return {'cli_failure':p.stderr[-400:]}
def detail(value): return value.get('output',{}).get('details',{})
run={'action':'run','pipeline':'/probe-state/workspace/crew-prototype.lobster'}
a=call(run); b=call(run)
da,db=detail(a),detail(b)
print('start1',da.get('status'),'start2',db.get('status'))
if da.get('status')!='needs_approval' or db.get('status')!='needs_approval': print(json.dumps([a,b])); raise SystemExit(1)
x=da['requiresApproval']['approvalId']; y=db['requiresApproval']['approvalId'];print('independent_approval_ids',x!=y)
r=call({'action':'resume','approvalId':x,'approve':False}); print('deny_result',json.dumps(detail(r)))
s=call({'action':'resume','approvalId':y,'approve':True}); print('approve_result',json.dumps(detail(s)))
t=call({'action':'resume','approvalId':y,'approve':True}); print('replay_ok',t.get('ok'),'error',t.get('error',{}).get('code'))
