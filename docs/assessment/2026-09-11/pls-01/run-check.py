import pathlib,subprocess,os,time,json,tempfile,sys
root=pathlib.Path.cwd(); evidence=root/'docs/assessment/2026-09-11/pls-01'; name=sys.argv[1]; cmd=sys.argv[2:]
env=os.environ.copy(); env['PATH']='/Users/lluzi/.local/node24/bin:'+env['PATH']
for key in list(env):
 if any(s in key for s in ['API_KEY','AUTH_TOKEN','SSH_AUTH_SOCK','HIMA_FIXTURES_OPTIONAL']): env.pop(key,None)
with tempfile.TemporaryDirectory(prefix='hpls-',dir='/tmp') as temp:
 env.update(TMPDIR=temp,TMUX_TMPDIR=temp,DSH_HOME=temp+'/dsh',DSH_AGENTS_HOME=temp+'/agents',HIMA_USER_DATA=temp+'/electron',DSH_TELEMETRY_DISABLED='1',HIMA_SSH_ATTEMPTS=str(evidence/(name+'-ssh.jsonl')))
 attempts=pathlib.Path(env['HIMA_SSH_ATTEMPTS']); attempts.write_text('')
 env['NODE_OPTIONS']='--import='+str(root/'test/contract/support/no-ssh.mjs')
 started=time.monotonic()
 with (evidence/(name+'.log')).open('w') as f: p=subprocess.run(cmd,env=env,stdout=f,stderr=subprocess.STDOUT)
 result=dict(command=cmd,exitCode=p.returncode,seconds=round(time.monotonic()-started,3),sshAttempts=len(attempts.read_text().splitlines()))
 (evidence/(name+'.json')).write_text(json.dumps(result,indent=2)+'\n'); print(json.dumps(result))
