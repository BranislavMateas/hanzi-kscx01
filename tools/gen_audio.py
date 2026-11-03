import asyncio,json,re,os,edge_tts
d=json.loads(re.sub(r'^const DATA=|;\s*$','',open('data.js',encoding='utf8').read().strip()))
s=json.loads(re.sub(r'^const SENT=|;\s*$','',open('sentences.js',encoding='utf8').read().strip()))
A=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','audio')
jobs=[]
for c in d['chars']:jobs.append((c['a'],c['c']))
for w in d['words']:jobs.append((w['a'],w['zh'].replace('…','，')))
for i in s['items']:jobs.append((i['a'],i['zh']))
jobs=[(a,t) for a,t in jobs if not os.path.exists(f'{A}/{a}') and not os.path.exists(f'newaudio/{a}')]
print('todo',len(jobs),flush=True)
sem=asyncio.Semaphore(6);fails=[]
async def one(a,t):
    async with sem:
        for k in range(4):
            try:
                # the voice reads 操 as cāo; 肏 gives the slang reading cào
                await edge_tts.Communicate(t.replace('操','肏'),'zh-CN-XiaoxiaoNeural').save(f'newaudio/{a}.tmp');os.replace(f'newaudio/{a}.tmp',f'newaudio/{a}');return
            except Exception as e:
                await asyncio.sleep(2+2*k)
        fails.append((a,t))
async def main():
    await asyncio.gather(*[one(a,t) for a,t in jobs])
asyncio.run(main());print('done; fails',fails)
