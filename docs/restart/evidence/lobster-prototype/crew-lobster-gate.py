import concurrent.futures, json, sqlite3, subprocess, tempfile, os
path=os.path.join(tempfile.mkdtemp(prefix='lobster-gate-prototype-'),'gate.sqlite')
def connect():
 c=sqlite3.connect(path,timeout=15,isolation_level=None); c.execute('PRAGMA journal_mode=WAL'); return c
with connect() as c: c.execute('CREATE TABLE admissions(issue TEXT PRIMARY KEY, state TEXT NOT NULL, approval_id TEXT)')
def start(issue):
 c=connect()
 try:
  c.execute('BEGIN IMMEDIATE')
  row=c.execute('SELECT state,approval_id FROM admissions WHERE issue=?',(issue,)).fetchone()
  if row: c.execute('COMMIT'); return ('existing',row[0])
  c.execute('INSERT INTO admissions(issue,state) VALUES (?,?)',(issue,'starting')); c.execute('COMMIT')
  p={'name':'lobster','args':{'action':'run','pipeline':'/probe-state/workspace/crew-prototype.lobster'}}
  cli=['docker','exec','crew-lobster-probe','node','dist/index.js','gateway','call','tools.invoke','--json','--params',json.dumps(p)]
  r=json.loads(subprocess.run(cli,capture_output=True,text=True,timeout=45,check=True).stdout)
  d=r['output']['details']; assert d['status']=='needs_approval'; approval=d['requiresApproval']['approvalId']
  c.execute('UPDATE admissions SET state=?, approval_id=? WHERE issue=?',('waiting',approval,issue)); return ('created','waiting')
 finally: c.close()
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(start,['owner/repo#17']*2))
print('concurrent_results',sorted(results))
print('after_reopen',start('owner/repo#17'))
with connect() as c: c.execute('INSERT INTO admissions(issue,state) VALUES (?,?)',('owner/repo#18','starting'))
print('interrupted_before_receipt',start('owner/repo#18'))
with connect() as c: print('stored_states',c.execute('SELECT issue,state FROM admissions ORDER BY issue').fetchall())
