from pathlib import Path
import subprocess,tempfile,os,time,json,shutil,sys
root=Path.cwd(); out=root/'docs/assessment/2026-09-11/pls-06/partial-fork'; tmp=Path(tempfile.mkdtemp(prefix='hima-partial-',dir='/tmp')).resolve()
env=os.environ.copy(); env.update(TMPDIR=str(tmp),TMUX_TMPDIR=str(tmp),DSH_HOME=str(tmp/'dsh'),DSH_AGENTS_HOME=str(tmp/'agents'),HIMA_USER_DATA=str(tmp/'electron'),DSH_TELEMETRY_DISABLED='1',HIMA_TEST_GROUP='local',HIMA_TEST_TMPDIR=str(tmp),HIMA_SSH_ATTEMPTS=str(tmp/'ssh-attempts.jsonl'),NODE_OPTIONS='--import='+str(root/'test/contract/support/no-ssh.mjs'))
for k in ['TMUX','SSH_AUTH_SOCK','NODE_TEST_CONTEXT']: env.pop(k,None)
args=['/Users/lluzi/.local/node24/bin/node','--test','--test-reporter=tap',str(out/'probe.ts')]
start=time.monotonic(); exit_code=1
try:
  run=subprocess.run(args,env=env,cwd=root,text=True,capture_output=True,timeout=55)
  (out/'probe.log').write_text(run.stdout+run.stderr)
  attempts=(tmp/'ssh-attempts.jsonl').read_text() if (tmp/'ssh-attempts.jsonl').exists() else ''
  exit_code=run.returncode if not attempts else 1
  (out/'execution.json').write_text(json.dumps({'command':args,'exitCode':exit_code,'elapsedSeconds':round(time.monotonic()-start,3),'sshAttempts':len(attempts.splitlines()),'node':subprocess.check_output([args[0],'--version'],text=True).strip(),'baseline':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()},indent=2)+'\n')
  print(run.stdout+run.stderr); print('SSH attempts:',len(attempts.splitlines()))
finally:
  subprocess.run(['tmux','-S',str(tmp/('tmux-'+str(os.getuid()))/'default'),'kill-server'],env=env,capture_output=True,timeout=5)
  shutil.rmtree(tmp)
sys.exit(exit_code)
