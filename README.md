# 汉字 KSCX01

Osobná appka na učenie čínštiny pre slovenských študentov: najprv celé vety, potom slová a znaky. Vznikla ako pomôcka ku kurzu KSCX01 a na cestu do Číny.

- vety ku *Integrated Chinese, Level 1 Part 1* (po s. 83) a frázy na cestovanie
- opakovanie v intervaloch, testy po každej dávke, skúšky so životmi
- skladanie viet, posluch, hovorenie, tieňovanie a kreslenie znakov ťah po ťahu
- funguje offline, postup sa ukladá len v prehliadači

## Spustenie

Stačí otvoriť `index.html`. Alebo ju načítaj ako rozšírenie Chromu, ktoré nahradí novú kartu: `chrome://extensions` → režim vývojára → *Load unpacked* → tento priečinok.

Chyba `restore.js` v konzole je v poriadku. Je to môj osobný súbor s postupom a v repozitári nie je.

## Pridanie obsahu

Zdroje sú v `tools/` (`sent.txt`, `lex.txt`, `chars.txt`, `words.txt`). Spúšťaj z tohto priečinka:

```sh
python3 build.py        # vytvorí data.js a sentences.js
mkdir -p newaudio
python3 gen_audio.py    # chýbajúce nahrávky do newaudio/, potrebuje edge-tts
python3 gen_strokes.py  # doplní ťahy znakov do strokes.js
```

Potom skopíruj `data.js`, `sentences.js`, `strokes.js` a súbory z `newaudio/` do koreňa repozitára, resp. do `audio/`.

## Licencie a zdroje

- Kód appky: MIT, pozri `LICENSE`. Licencia sa nevzťahuje na materiály tretích strán nižšie.
- [Hanzi Writer](https://github.com/chanind/hanzi-writer) (`hanzi-writer.min.js`): MIT, pozri `licenses/`.
- Dáta ťahov (`strokes.js`) z [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data): Arphic Public License, pozri `licenses/`.
- Nahrávky sú generované cez [edge-tts](https://github.com/rany2/edge-tts) hlasom `zh-CN-XiaoxiaoNeural`.
- Vety s odkazom na stranu vychádzajú z učebnice *Integrated Chinese*. Projekt s jej autormi ani vydavateľom nijako nesúvisí a učebnica tu nie je.
