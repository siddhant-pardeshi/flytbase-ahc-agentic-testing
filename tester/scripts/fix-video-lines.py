import json
import os
import re

r = json.load(open('evaluation/results.json'))
doc = open('evaluation/EVALUATION.md', encoding='utf-8').read()

lines = doc.split('\n')
out = []
sec = 0
for line in lines:
    m = re.match(r'^### (\d+)\. ', line)
    if m:
        sec = int(m.group(1))
    if line.startswith('**Video.**') and 1 <= sec <= len(r['scenarios']):
        vids = r['scenarios'][sec - 1]['videos']
        names = [os.path.basename(v) for v in vids]
        links = ' | '.join('[%s](<VIDEO_LINK:%s>)' % (n, n) for n in names)
        out.append('**Video.** ' + links.replace(' | ', ' \u00b7 '))
    else:
        out.append(line)

open('evaluation/EVALUATION.md', 'w', encoding='utf-8').write('\n'.join(out))
print('rewrote', len(r['scenarios']), 'scenario video lines')
