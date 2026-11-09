/**
 * The face on the Me page, sampled from the hero effect test (a 9 px monospace cell, 5.4 px wide
 * and 12 px tall, cut finer than before so it holds up at the bigger size), and the strip of code
 * across the top of the page. One character per cell, 16 levels from empty (a space) to full (@).
 * Read them as pictures: the page draws each lit cell as a code symbol that resolves into place.
 */

import { hash, RAMP } from "./portrait.ts";

export interface Art {
  cols: number;
  rows: number;
  /** photo: soft shading, 0 and 1 glyphs. mark: a bold shape, mixed glyphs. */
  tone: "photo" | "mark";
  cells: readonly string[];
}

export const FACE: Art = {
  cols: 88,
  rows: 56,
  tone: "photo",
  cells: [
    "                                                                                        ",
    "                                                                                        ",
    "                                  ,+~--=+=+++++=;,                                      ",
    "                             ..::=xx+*xx#Xx+~~=++xXx++=-:,.                             ",
    "                       ,;=*xxXXX%%+~=x*++x+~~*X###%&%%######x+=;                        ",
    "                     .+#&x*%X#X%*x-~**~=x%~-*x***x*~~===~~~=====~:.                     ",
    "                    :X#&#*X&+&##&X=++%+=x&~;-~=~~==~+*+*x%@&&@@@&%#+;                   ",
    "                   -x%%x*+*xXx#%x#+~+*%=+#X-:~+~===x*=+x%%&@#x**x###&%~.                ",
    "                .-x&&@X+*==~=~XXx+X=~;+#*X&X:-=-*+X=~;x#&#*=+x###XXXXX##~:..            ",
    "             ,;=X###&@%=-**=-;,+x+:--:,-xx#&x-~;*++-;+X&+~==*X%#%%%%XxXx%%#%x~          ",
    "          .+&&@&%%&&%#*+,.:~~-..,;:.....:~**X~~;===--+X~~~~~;;;;:,,,~X&#X%@##%=         ",
    "          +@@@@#x***x*::...,:;---~===~~-;;-==+~-*++++=*+==+=~:......,:~&&%&&###x;       ",
    "         ~&#*=~=****++=+*xxxx+===~--~~+***XXX*x*x*+==+++*~~=+XX*~,....:~#@##%#X%&=      ",
    "        -&%+=~;::::;=X#x+~~=~~==~~==~-~++=++++~~=++==++===~===+*#&x~,,,:;*%xx%%&%@:     ",
    "       ~&@**x**x=:-X&*=+==+++====++=+~+*+++****+**+++======+===~~=*#%*:,:;~x##&@%@&     ",
    "      .&@@x=;:--=X#X++==~-=~=~~~=+x+~+*xX*xXx=*x+=++*==+=+==+=======*#&*--~*#%@%%#@-    ",
    "     ,X@@@XxxX*=~#+===~~=~=~++**++x*++xxxx*xXxx#XX###XXX**xXx+=+======x@%~--=x#@@X@%    ",
    "    +X@@&@@&&#xXX+==~=+~~~-~~+x+++x*x*xxX#X*xX#XXXxXxxxx=xxx++==~~~~++++%%=~*#%&&#&@    ",
    "    ,x@&%X@@#++++*=~~~=~=~~~~=++*+=++xx*+*xx***x**x*xx*xXx***++===~~~=+*+x#XX%&@#X@%    ",
    "     .@%%###XxXXx---=+~~++~~~~-+=&x*xXxXx**xxXx****XXX*xXX##x+++==~==+*=+***x#&%@&&&    ",
    "     .@&%%##%%x~---====---==~~=**&*=*xXX*+xx*xxxx**X##x+x+xx*====++=++=~=**xX#%&%@&@    ",
    "     .@@%@%@X~;+*+++=+~-~~~+=~=**x#%%x*x**xXXXX+*xx#x*++x+++++======+++*=x%**&&%%x@@    ",
    "      &@%@@&=-*+Xx*=+*~~==+++*===~~-*+**+***==+X**xx******+=++++*+=++**xX*#&=+@@#*@@    ",
    "      x@%@@&=xxX%XXX**xx**xxxx***++=+++*+~~-=+=+*==~++*xx****+++**++*x%%%##@#x@@%x@x    ",
    "      ;@&@@#x##&#%@&%X======~~+==~+*xxx*~-;~=+==---~+xxX##%&@&##XxxxX#@@#X%@@*#@@&@,    ",
    "      .%@@@xxX###@@*;,--;;;;--:,,....,:,,-~~~=~=~~=;-~---;-;;;;;~==~-~x@@x#&@xX@&@+     ",
    "       +@&@x&Xxx@@x-,,:;-;;=*XX*~;,.......;*=XXx*==++~;:,,;=xXx*++~-~=*%@%*X@&#@@@~     ",
    "      ,#&&@#@xX&@#~;,,-~--==~=x++*=;,.....~#X%xXXXXX*-::---=+X*##x%#*~XX%@#X#@&&&@@-    ",
    "      #@#XX%&%#&%+:,.~~+xXXX%&&&@&@X+=;,:~XX*%**+*%xx#x*XxX#&&&@&@%#X++*x&%&#@#X#@@~    ",
    "       .+%*&%&%%x~-----=x%&&&&%%%#X**#+--=~*#X+*+=x+xx#x+*X#&&&@@&XxXx=-=%&&#%#x@#-     ",
    "        .#@&%&#x+=+===~~---~=+++***xX*~==~-=#X**++xx+**x#X+=~=====+*+=~=+X%&#x&&x#-     ",
    "        ;X@&&@#x+~=~~=**+++*XX*===++=--;--~~x#**+**X+~+x*X*+*****xxx*****X%@X*&&X%#     ",
    "        +*@@&@@*~==+***x++++x*+=+==~=+---~*+*x**+xxx=-~=+**x**+========~=*#@#x@###;     ",
    "        *x&@&@&#=+==*X#x%###+*x*=*x+x=~x%%Xxxx++*X#&X=~~=++xXXx#*++*+==~=*%@#%@*X%.     ",
    "        ,X#@@@&%*----=-~*#**+=*x*+~~=x&&XX%*#X*+*XX#%&#=~===-;;=x++=~~~=+*%@#@%%##      ",
    "         x&#@&@&X~~~~=*x*xXX*+x~=+=+&&##%#x+X&#XXX%#X#&&=---*#X+*==~---=+X@&&&@&@-      ",
    "         =&%&&@&#=~-=*xxx~~;+X**~~=+@##*=~=~=Xx*+*x**%#@+~-~+x*~*+=~~~~~*%@%@#@@+       ",
    "          ;xX@%&#**;;::;-+~*;-~=*~-;*x==~=++=~=*X%##&&X#X~~~~-=~~----~=*x&@%@x%+        ",
    "           .*@&@#++-;;-;---~;;~~+~;;~;:...:X#X#%X===xX*+*x+-----~~~~~-+x#@&&@#=         ",
    "             +&@&*~--;~-;;-~=x*=+==~-~-,.,,,;-~+*=~=+==+++x+--~~~~=~~=*xX@&@%-          ",
    "             ;@&@X*+~=~:,-x=~~+=~--==--=-~x#X*+X#*+~=~=~===+++==~~-~=*+xX%%@*.          ",
    "             .&%&x*=-~==--++=+=~~=~--~===x&###XXXxx*+==~~~==+**x+=~~+**X#&&@+           ",
    "              ~%%X+=~~~~==--~=~~~-====**++x#&%#XXxX#Xxx+++=~=*++==~~=+x#&#@@+           ",
    "               =##X=~=--~;;--;;::;--:;------~~~~=++++==+=*x~;~=+**+++xxX&&@+,           ",
    "                X%#x+-;-=;;~:~~==-;-~~*xxxX%%##%##X*+=++xx##+;;-**=~+xx%&&.             ",
    "                ,X&%*~~~~--,,~**+~~~;;=xxXX*xXXX#Xx+=+++=~=*+;;~**==*x%%@~              ",
    "                 ,@@&x~~=~-:;~;-~-;:...,,,:-~------~~-;~+~=~~--=+*=*#&%@-               ",
    "                  %%&&#x*~~;;:-;:;;:;::,.,,::-~=~-;--;;~--;;--~==xX%&#%x                ",
    "                  ;%&##Xx+**~.,;~--====++xXxxX###X###*~~-;---~+XX%%%#@&~                ",
    "                   #&X*X%#XXx-;;;;~--~~=+==+*+******++**+=--~X%&%&%x#@%-                ",
    "                   %@+~~~x%%%#=;;--:-~~++*+++=+=~~===~++=~~+#&&@&x*+X@&;                ",
    "                   &@=~~;:;=#%##x~;-~===-~~---~==~~~===~~*%&&@%++=~=X@%.                ",
    "                   ..     ...:;:;:,...,....,,..,::,,-~*#&&&&X~-;;;;:-=-                 ",
    "                                                    ;*+=;,.                             ",
    "                                                                                        ",
    "                                                                                        ",
  ],
};

/**
 * The strip across the top of the Me page: a field of code symbols, lit everywhere, that
 * resolves from the left and then holds, like the face. It is written by a rule, not by hand:
 * soft diagonal waves with a little noise, dimmer towards the bottom edge. The same 5.4 px by
 * 12 px cell as the face.
 */
function makeCover(cols: number, rows: number): readonly string[] {
  const out: string[] = [];
  for (let y = 0; y < rows; y++) {
    let row = "";
    for (let x = 0; x < cols; x++) {
      const wave = 0.5 + 0.5 * Math.sin(x * 0.09 + y * 0.55) * Math.cos(x * 0.031 - y * 0.2);
      const noise = 0.55 + 0.45 * hash(x, y + 101);
      const down = 1 - (y / (rows - 1)) ** 2 * 0.7;
      const level = Math.round(2 + 6 * wave * noise * down);
      row += RAMP.charAt(Math.min(RAMP.length - 1, Math.max(1, level)));
    }
    out.push(row);
  }
  return out;
}

export const COVER: Art = {
  cols: 160,
  rows: 8,
  tone: "photo",
  cells: makeCover(160, 8),
};
