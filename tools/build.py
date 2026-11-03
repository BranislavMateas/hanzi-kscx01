import json,re,hashlib
P='，。？！、：；…“”()（）'
def rows(f,n):
    out=[]
    for l in open(f,encoding='utf8'):
        l=l.rstrip('\n')
        if not l or l[0]=='#':continue
        p=l.split('|');assert len(p)==n,l
        out.append(p)
    return out
lex={a:[b,c] for a,b,c in rows('lex.txt',3)}
assert len(lex)==len(rows('lex.txt',3))
groups=[];items=[];g=None;seen=set()
TIME={'今天','明天','昨天','今年','明年','现在','星期一','星期四','星期五','晚上','早上','上午','中午','下午'}
PRON={'我','你','他','她','我们','你们','他们'}
for l in open('sent.txt',encoding='utf8'):
    l=l.rstrip('\n')
    if not l or l[0]=='#':continue
    if l.startswith('G '):
        i,t,ic,k=l[2:].split('|');groups.append(dict(id=i,t=t,i=ic,k=k));g=i;continue
    p=l.split('|');raw=p[0].split();zh=''.join(raw)
    assert zh not in seen,zh;seen.add(zh)
    t=[x for x in raw if x not in P]
    for x in t:assert x in lex,'missing lex: '+x
    sid=hashlib.md5(zh.encode()).hexdigest()[:8]
    it=dict(id=sid,g=g,zh=zh,py=p[1],sk=p[2],t=t,a=f's_{sid}.mp3')
    if len(p)>3:it['p']=p[3]
    if len(t)>2 and ((t[0] in TIME and t[1] in PRON) or (t[0] in PRON and t[1] in TIME)) and '，' not in zh:
        it['alt']=''.join([t[1],t[0]]+t[2:])
    items.append(it)
used={x for it in items for x in it['t']}
print('unused lex',[k for k in lex if k not in used])
lex={k:v for k,v in lex.items() if k in used}
open('sentences.js','w',encoding='utf8').write('const SENT='+json.dumps(dict(groups=groups,lex=lex,items=items),ensure_ascii=False,separators=(',',':'))+';\n')
# data.js
src=open('orig_data.js',encoding='utf8').read().strip()
data=json.loads(re.sub(r'^const DATA=|;\s*$','',src))
have={c['c'] for c in data['chars']}
tab={r[0]:r for r in rows('chars.txt',5)}
assert len(tab)==len(rows('chars.txt',5))
need=[]
for it in items:
    for c in it['t']:
        for ch in c:
            if '一'<=ch<='鿿' and ch not in have and ch not in need:need.append(ch)
wds=rows('words.txt',3)
for z,_,_ in wds:
    for ch in z:
        if '一'<=ch<='鿿' and ch not in have and ch not in need:need.append(ch)
print('missing mnemonic',[c for c in need if c not in tab],'extra',[c for c in tab if c not in need])
base=len(data['lessons'])
names={'t3':'L3: Dátum a čas','c1':'Cesta: prežitie','c2':'Cesta: jedlo','c3':'Cesta: nákupy','c4':'Cesta: doprava','c5':'Cesta: hotel','c6':'Cesta: výlety','c7':'Cesta: rozhovor','c8':'Cesta: núdza','c9':'Najčastejšie vzory','x1':'Slang'}
order=list(names);first={}
for it in items:
    for tok in it['t']:
        for ch in tok:
            if ch in tab and ch not in first:first[ch]=it['g']
for z,_,_ in wds:
    for ch in z:
        if ch in tab:first[ch]='t3' if ch in first and first[ch] in('t0','t1','t2','t3') else first.get(ch,'t3')
lessons=[]
for g2 in order:
    if any(v==g2 for v in first.values()):lessons.append(g2)
data['lessons']+= [names[x] for x in lessons]
for ch in need:
    if ch not in tab:continue
    r=tab[ch];gg=first.get(ch,'t3')
    if gg not in lessons:gg='t3'
    data['chars'].append(dict(c=ch,py=r[1],m=r[2],p=r[3],n=r[4],l=base+lessons.index(gg),a=f'ch_{ord(ch):x}.mp3'))
hz={w['zh'] for w in data['words']}
wid=1800000000000
for z,py,en in wds:
    if z in hz:continue
    data['words'].append(dict(id=wid,en=en,zh=z,py=py,a=f'kscx01_{wid}.mp3'));wid+=1
open('data.js','w',encoding='utf8').write('const DATA='+json.dumps(data,ensure_ascii=False)+';')
print('lessons',data['lessons'],'chars',len(data['chars']),'words',len(data['words']),'sentences',len(items),'alts',sum('alt' in x for x in items))
import collections;print(collections.Counter(c['l'] for c in data['chars']))
