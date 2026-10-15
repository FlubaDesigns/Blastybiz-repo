"""Conservative pre-beta layout gate. Unknown or executable changes use full CI."""
import json, os, re, subprocess, sys
from html.parser import HTMLParser
from pathlib import Path

SHA = re.compile(r'^[0-9a-f]{40}$')
VISUAL = {'class', 'style', 'title', 'alt', 'aria-label', 'aria-labelledby', 'aria-describedby'}
SENSITIVE = re.compile(r'(login|signup|start|createbiz|owner-access|auth|checkout|plan-|payment|billing|admin)', re.I)

class Contract(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.records, self.script = [], None
    def handle_starttag(self, tag, attrs):
        attrs = sorted((k, v or '') for k, v in attrs if k not in VISUAL)
        # Wrapping/reordering layout containers and changing copy is presentation.
        # Script bodies, handlers, URLs, IDs and form/control attributes must match.
        if attrs or tag in {'script','form','input','button','select','textarea','iframe','object','embed','base','meta','link'}:
            self.records.append(('tag', tag, attrs))
        if tag == 'script': self.script = []
    def handle_startendtag(self, tag, attrs): self.handle_starttag(tag, attrs)
    def handle_data(self, text):
        if self.script is not None: self.script.append(text)
    def handle_endtag(self, tag):
        if tag == 'script' and self.script is not None:
            self.records.append(('script', ''.join(self.script)))
            self.script = None
    def signature(self, source):
        self.feed(source); self.close()
        if self.script is not None: raise ValueError('unclosed script')
        return sorted(json.dumps(r, sort_keys=True) for r in self.records)

def eligible(path, before, after, status='M'):
    if status != 'M' or not path.startswith('public/') or '..' in path.split('/'):
        return False
    ext = Path(path).suffix.lower()
    if ext in {'.png','.jpg','.jpeg','.webp','.gif','.ico','.avif','.woff','.woff2'}: return True
    if ext == '.css': return True
    if ext != '.html' or SENSITIVE.search(Path(path).name): return False
    try: return Contract().signature(before) == Contract().signature(after)
    except Exception: return False

def git(*args): return subprocess.check_output(['git', *args])
def classify(base, head):
    if not SHA.fullmatch(base or '') or not SHA.fullmatch(head or '') or base == '0'*40:
        return {'mode':'full', 'reason':'missing comparison baseline', 'files':[]}
    try:
        if subprocess.call(['git','merge-base','--is-ancestor',base,head], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL):
            return {'mode':'full','reason':'non-ancestor baseline','files':[]}
        raw=git('diff','--name-status','--no-renames','-z',base,head).decode().split('\0')
        entries=list(zip(raw[0:-1:2],raw[1:-1:2]))
        if not entries: return {'mode':'full','reason':'empty comparison','files':[]}
        for status,path in entries:
            before=after=''
            if path.endswith(('.html','.css')) and status=='M':
                before=git('show',base+':'+path).decode();after=git('show',head+':'+path).decode()
            if not eligible(path,before,after,status):
                return {'mode':'full','reason':'runtime or unclassified change: '+path,'files':[p for _,p in entries]}
        return {'mode':'layout','reason':'presentation-only delta','files':[p for _,p in entries]}
    except Exception as error:
        return {'mode':'full','reason':'comparison unavailable: '+type(error).__name__,'files':[]}

if __name__=='__main__':
    result=classify(os.environ.get('BASE_SHA',''),os.environ.get('HEAD_SHA',''))
    print(json.dumps(result))
    Path('layout-scope.json').write_text(json.dumps(result))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a') as f:f.write('mode='+result['mode']+'\n')
