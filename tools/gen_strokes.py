import time,json,re,urllib.parse,urllib.request,concurrent.futures as cf
d=json.loads(re.sub(r'^const DATA=|;\s*$','',open('data.js',encoding='utf8').read().strip()))
src=open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)),'..','strokes.js'),encoding='utf8').read().strip()
S=json.loads(re.sub(r'^const STROKES=|;\s*$','',src))
need=[c['c'] for c in d['chars'] if c['c'] not in S]
def get(ch):
    u='https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/'+urllib.parse.quote(ch)+'.json'
    for k in range(6):
        try:
            return ch,json.load(urllib.request.urlopen(u,timeout=40))
        except Exception:
            time.sleep(3+k*3)
    return ch,None
with cf.ThreadPoolExecutor(3) as ex:
    res=list(ex.map(get,need))
for ch,j in res:
    if j: S[ch]={k:j[k] for k in('strokes','medians')}
open('strokes.js','w',encoding='utf8').write('const STROKES='+json.dumps(S,ensure_ascii=False,separators=(',',':'))+';\n')
print('strokes',len(S),'added',len(need),'missing',[c['c'] for c in d['chars'] if c['c'] not in S])
