import json, subprocess
params={'name':'lobster','idempotencyKey':'crew-issue-17-stable-key','args':{'action':'run','pipeline':'/probe-state/workspace/crew-prototype.lobster'}}
base=['docker','exec','crew-lobster-probe','node','dist/index.js','gateway','call','tools.invoke','--json','--params',json.dumps(params)]
values=[]
for i in range(2):
 p=subprocess.run(base,capture_output=True,text=True,timeout=45); data=json.loads(p.stdout); d=data.get('output',{}).get('details',{}); values.append(d.get('requiresApproval',{}).get('approvalId')); print('call',i+1,'ok',data.get('ok'),'status',d.get('status'))
print('approval_ids_same',values[0]==values[1], 'both_present',all(values))
