"""Display-only demo Pack: placeholders; the recorded take stages the data."""
import json, sys
json.dump({}, open(sys.argv[2], "w"))
