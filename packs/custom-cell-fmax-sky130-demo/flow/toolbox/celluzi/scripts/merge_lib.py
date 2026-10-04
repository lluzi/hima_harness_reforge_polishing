#!/usr/bin/env python3
# Merge custom cells into a base liberty by inserting the custom cell() groups before the base's
# final closing brace. Usage: merge_lib.py <base.lib> <custom.lib> <out.lib>
import sys, re
base, custom, out = sys.argv[1], sys.argv[2], sys.argv[3]
b = open(base).read(); c = open(custom).read()

def extract_groups(text, keywords):
    """Return top-level `keyword ( ... ) { ... }` group texts (brace-balanced)."""
    groups, i = [], 0
    pat = re.compile(r'\n[ \t]*(?:' + '|'.join(keywords) + r')[ \t]*\(')
    while True:
        m = pat.search(text, i)
        if not m:
            break
        start = m.start() + 1
        b0 = text.index('{', start)
        depth, j = 1, b0 + 1
        while depth and j < len(text):
            depth += (text[j] == '{') - (text[j] == '}')
            j += 1
        groups.append(text[start:j])
        i = j
    return groups

templates = extract_groups(c, ['lu_table_template', 'power_lut_template'])
cells = extract_groups(c, ['cell'])
k = b.rstrip().rfind('}')                       # base library's closing brace
extra = "\n  /* ---- celluzi custom templates+cells ---- */\n" + "\n".join(templates + cells) + "\n"
open(out, "w").write(b[:k] + extra + b[k:])
print("merged %d template(s) + %d custom cell(s) -> %s" % (len(templates), len(cells), out))
