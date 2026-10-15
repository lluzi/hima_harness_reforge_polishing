"""Display-only demo Pack: each task is a placeholder; the recorded Run's data is staged."""
import json, sys
json.dump({}, open(sys.argv[2], "w"))
