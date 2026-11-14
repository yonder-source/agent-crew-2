import json,subprocess
params={'name':'lobster','args':{'action':'run','pipeline':'/probe-state/workspace/agent-handoff.lobster','timeoutMs':30000}}
p=subprocess.run(['docker','exec','crew-lobster-probe','node','dist/index.js','gateway','call','tools.invoke','--params',json.dumps(params),'--json'],capture_output=True,text=True,timeout=50)
d=json.loads(p.stdout); print(json.dumps({'ok':d.get('ok'),'details':d.get('output',{}).get('details'),'error':d.get('error')}))
