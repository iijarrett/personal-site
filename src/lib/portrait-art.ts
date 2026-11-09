/**
 * The face and the JD mark, sampled from the hero effect test at its small cell (a 9 px
 * monospace cell, 5.4 px wide and 12 px tall). One character per cell, 16 levels from empty
 * (a space) to full (@). Read them as pictures: the page draws each lit cell as a code symbol
 * that resolves into place.
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
  cols: 72,
  rows: 46,
  tone: "photo",
  cells: [
    "                                                                        ",
    "                                                                        ",
    "                            ;=--++*+++=-:.                              ",
    "                     .::;-=xx+*xxx*=-~+xX#X#X*=~-:.                     ",
    "                  :=XX#XXXXx-~x==X*-*XXxXXx*+++++++=;.                  ",
    "                 ~#&Xx&*&&#x~+#=+#+;~==~=~=++*x%%&&&%X+:                ",
    "               .+X&x*+xXX#x#+==%+*%~:+~==+x=+X%&%XxxX#%%#~              ",
    "             :=#%@%=*=~--xx+*~--Xx#%;~-+**~-X%#+=+#%%XXXXX#=-;,         ",
    "         .=*XX#%&&#+,~+~;.~=::,.:=xXx=;~+~-+X+~====++++x##X%&##~        ",
    "        .#@@&#Xxxx~;...::::;--;;::-=+=;=++==+=~=~-:.....;x&#&%%%+,      ",
    "       .x%*==+*+++==***x+==~~~=+**xxx****+=++++~+*x*=,...;+@%#%X#%:     ",
    "      .x@*=~-;::~XXx=~=~~=~~==-~+==+++~=+==++======+x%X~,,:-XXX%&%%.    ",
    "      *@%++~~==x%+=======~=+*==+***x****++*=====+===~=+#%+;;~x%&&%&*    ",
    "     ;@@%*+*+~x*=+~~~=~==+++x==*x**xXxXxx#Xxxx****=+====+#%=-~*#@&#&.   ",
    "   .+&@&&&&#xx*=~==~~-~~**++x**xx##xxxXxxxx*x**xX++==~~=++x&+~x%&&#@:   ",
    "    ;&&%%@#+***=~~=~=~~~==+*+*Xx**xx*x***xxx*xx***++==~~=+*+xxX&@%#@,   ",
    "     X&#X#X#X+--~=~~=~==-==&*+xxX**xXxxx**X#xXX#%*=+===+++=**xx#&%&@:   ",
    "     X@&%%%+-+=+++=-~~===*x###Xxx+*xxX***X#x***+++=====+++=*X*%&%%#@:   ",
    "     *@%@@+-+xx+=*=~==+++++=~+******=+x**x*+*x+*=+++*+=+**Xx#%=%@XX@:   ",
    "     -@&@@=XX%##xxxxxXXXXxxx*+++*=~-===+=~=+xx**xx****+*x&%%#@X%@%#&.   ",
    "     .&&@&x#%#&@%+--;;;-;::,;~=+~~~~~==-~~~***xxXx*****+x&@X%@%*@@@;    ",
    "      +@@##XX#@X;:;-;:;~*+-:......:==**+~==~;:::-++==~~-~*@&x%@X@@@.    ",
    "     .x&&%@XX@%~:,;--~==**++~:....:XX%XXxX*~::--=*xx#X#*~X#@#X&%@&@*    ",
    "     ~%#X#&%#&+:,:=+xXX%%&&&&x*-:;*xxX++*%*Xx*XX#&%@%&%X*++%&&#%X%@x    ",
    "       =##%&#X===~-~+x###XXXx+X+~=~+%x*++x+xXx**xX#%#XX**=~x&@X&X&*     ",
    "       :&@%&X*~+~=+*+==*x*+++*=----~xX*+*x*=*xXx+++++*x*+++x#@x#@x%:    ",
    "       *#@%@%=~=++*x+++x+===~~+-;-++xx*+*x*~~+**x**========*#@x%%##.    ",
    "       *x@&@%*===xX*#XX+**+**++=X%Xxx*+*X%%+~~=+*x*X*+++=~~+#@X@xX*     ",
    "       :#%@@&#~--~=+xx*++*++==#&#X#*#X**##X#&+~~===~*==~-~=*%@&&&&~     ",
    "        %&&&@%=~~+*x*++xx+=~~#&&#*++x%Xx*Xx%%%~-~x#=*+=--~=x@%@&&#      ",
    "        :xX@&%x+-;-~=~=-==+~-=x+~=+===+x%##%X%+~~~~~~---~=*#@&%XX.      ",
    "          =@@&+=-;-;--~;~~+~;;~:..,*XX%X==+X*+**~---~~~~-+X&&@%*.       ",
    "           +&@X=-;-;:-~=*++==~-~;::;-;=x+~===++*=--~~~~~+*x%&@*.        ",
    "           ;&&x*~=+-;++~~~-~-~~~==X%%XX#**+~~~~~=+**+=~=**X%&@;         ",
    "           .#%X+=~-~~~-~+~~====**+x%%%#XXXXx*=+==+*+=~~~+x#&&@;         ",
    "            .##x==~-~;--;;:;--;-~~~~===+++++=++x=-==**++*x%&&=.         ",
    "             ;%%x~;-~;-:===-;--*Xxx%%#%%#x+==+*xX=;-++~=xX%&.           ",
    "              ~&&*~~~~::~~==~;::-~+==+++++===*===~;~+*=*X%&~            ",
    "               &&&X*+~;;;-;::,,,..,:;---;;;;;~-;---==xx%%&~             ",
    "               -&##Xx+*~.:--~====+***XX#XXX*=~;;;-=XX%%#&&,             ",
    "               ,%#+*%#X#-;;;--~~+==++++++++=++=~~+%&&%xX@%.             ",
    "               ,@x~~-=X%#*~-;;~=++**=++~~=+=+===X&&%x++x@#.             ",
    "               .~;,,..,;=~+~::,;::,,,,:--:;-~x#&@%+~~--~X=              ",
    "                                          .**=;:..                      ",
    "                                                                        ",
    "                                                                        ",
  ],
};

export const MARK: Art = {
  cols: 72,
  rows: 22,
  tone: "mark",
  cells: [
    "                                                                        ",
    "                                                                        ",
    "                                   @@@@@@@                     ######   ",
    "                                   @@@@@@@                    *@@@@@@   ",
    "                                   @@@@@@@                    *@@@@@@   ",
    "                                   *xxxxx                     *@@@@@@   ",
    "   @@@&X                     #@@@@@@@@@@@#           x&@@@@@&Xx@@@@@@   ",
    "   @@@@@@@@@#x               @@@@@@@@@@@@@         X@@@@@@@@@@@@@@@@@   ",
    "   @@@@@@@@@@@@@@&#*         @@@@@@@@@@@@@        &@@@@@@@@@@@@@@@@@@   ",
    "      x#&@@@@@@@@@@@@@@#           @@@@@@@       *@@@@@@@#   X@@@@@@@   ",
    "            *#&@@@@@@@@@           @@@@@@@       %@@@@@@@     %@@@@@@   ",
    "          x#&@@@@@@@@@@@           @@@@@@@       @@@@@@@X     *@@@@@@   ",
    "    X%@@@@@@@@@@@@@@@%x            @@@@@@@       %@@@@@@&     %@@@@@@   ",
    "   @@@@@@@@@@@@&X                  @@@@@@@       *@@@@@@@X   x@@@@@@@   ",
    "   @@@@@@@#x                       @@@@@@@        @@@@@@@@@@@@@@@@@@@   ",
    "   @%X                             @@@@@@@         #@@@@@@@@@@@@@@@@@   ",
    "                                  x@@@@@@@           X&@@@@@@# @@@@@@   ",
    "                           *xxxxx#@@@@@@@&                              ",
    "                           @@@@@@@@@@@@@@                               ",
    "                           @@@@@@@@@@@@%                                ",
    "                                                                        ",
    "                                                                        ",
  ],
};

/**
 * The strip across the top of the Me page: a field of code symbols, lit everywhere, that
 * resolves from the left and then holds, like the face. It is written by a rule, not by hand:
 * soft diagonal waves with a little noise, dimmer towards the bottom edge. The same 5.4 px by
 * 12 px cell as the pictures above.
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
  rows: 14,
  tone: "photo",
  cells: makeCover(160, 14),
};
