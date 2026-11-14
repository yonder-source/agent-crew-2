import json, subprocess
base=['docker','exec','crew-lobster-probe','node','dist/index.js','gateway','call','tools.invoke','--json','--params']
def call(pipeline):
 p=subprocess.run(base+[json.dumps({'name':'lobster','args':{'action':'run','pipeline':pipeline}})],capture_output=True,text=True,timeout=45)
 d=json.loads(p.stdout); return d.get('output',{}).get('details',d)
for name,pipeline in [('first',"exec --json --shell 'printf 1' | state.set probe.issue.claim"),('second',"exec --json --shell 'printf 2' | state.set probe.issue.claim"),('read','state.get probe.issue.claim')]: print(name,json.dumps(call(pipeline)))
