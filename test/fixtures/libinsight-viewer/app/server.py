# A stand-in for LibInsight's own app/server.py (contract tests only): the same argv (--config,
# --port), the same loopback bind and the same first route the Host waits on. A Kit named "crash"
# fails the way a missing numpy would: a message on stderr and a non-zero exit before listening.
import argparse, json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ap = argparse.ArgumentParser(); ap.add_argument("--config"); ap.add_argument("--port", type=int)
a = ap.parse_args()
cfg = json.load(open(a.config))
ids = [k["id"] for k in cfg["kits"]]
if "crash" in ids:
    print("ModuleNotFoundError: No module named 'numpy'", file=sys.stderr); sys.exit(3)
class H(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path == "/":
            body = ("<!doctype html><title>LibInsight fixture</title><h1>LibInsight fixture</h1><p>Kits: %s</p>" % ", ".join(ids)).encode()
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers(); self.wfile.write(body); return
        body = json.dumps([{"id": i} for i in ids] if self.path == "/api/kits" else sorted(os.environ) if self.path == "/env"
                          else dict(self.headers) if self.path == "/headers" else {"cwd": os.getcwd()}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
print("listening", a.port, flush=True)
ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()
