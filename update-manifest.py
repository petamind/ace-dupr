#!/usr/bin/env python3
"""
Run this after adding a new CSV file to data/:
  python3 update-manifest.py
Then commit and push:
  git add data/ && git commit -m "Add matches YYYY-MM-DD" && git push
"""
import json, glob, os

root = os.path.dirname(os.path.abspath(__file__))
matches = sorted(
    f.replace(root + os.sep, '').replace('\\', '/')
    for f in glob.glob(os.path.join(root, 'data', '*.csv'))
    if not f.endswith('players.csv')
)

manifest = {
    "players": "data/players.csv",
    "matches": matches,
}

out = os.path.join(root, 'data', 'index.json')
with open(out, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)

print(f"✓ data/index.json updated — {len(matches)} match file(s):")
for m in matches:
    print(f"  {m}")
