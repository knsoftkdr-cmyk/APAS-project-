// Picture content for the Nursery / LKG / UKG games. Emoji + one spoken word each: no reading required.
export type Pic = [emoji: string, word: string];
export type Animal = [emoji: string, word: string, sound: string];

export const P: Pic[] = [['🐶','Dog'],['🐱','Cat'],['🐮','Cow'],['🐷','Pig'],['🐸','Frog'],['🐔','Hen'],['🦆','Duck'],['🐟','Fish'],['🐘','Elephant'],['🦁','Lion'],['🐵','Monkey'],['🐰','Rabbit'],['🍎','Apple'],['🍌','Banana'],['🍇','Grapes'],['🍊','Orange'],['🍉','Watermelon'],['🚗','Car'],['🚌','Bus'],['🚲','Bicycle'],['✈️','Aeroplane'],['🚂','Train'],['⛵','Boat'],['⚽','Ball'],['⭐','Star'],['🏠','House'],['🌳','Tree'],['☀️','Sun'],['🌙','Moon'],['🎂','Cake']];
// first 12 = animals, next 5 = fruits, next 6 = vehicles (used by Fill the Basket)
export const basketCategory = (i: number) => (i < 12 ? 0 : i < 17 ? 1 : 2);
export const BASKETS: Pic[] = [['🐶', 'Animals'], ['🍎', 'Fruits'], ['🚗', 'Vehicles']];
export const BASKET_ITEMS = P.slice(0, 23);

export const FR: Pic[] = [['🍎','apple'],['🍌','banana'],['🍊','orange'],['🥭','mango'],['🍐','pear'],['🍋','lemon']];
export const COL: [hex: string, name: string][] = [['#FF4D4D','red'],['#3B82F6','blue'],['#22C55E','green'],['#EAB308','yellow'],['#A855F7','purple'],['#FF8A1F','orange']];
export const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const SY = ['🔴','🔵','🟢','🟡','🟣','🟠','⭐','🌙'];
export const SH: Pic[] = [['🔵','circle'],['🟦','square'],['🔺','triangle'],['⭐','star'],['❤️','heart'],['🔶','diamond']];
export const AN: Animal[] = [['🐶','Dog','Woof woof'],['🐱','Cat','Meow'],['🐮','Cow','Moo'],['🐷','Pig','Oink'],['🐸','Frog','Ribbit'],['🐔','Hen','Cluck cluck'],['🦆','Duck','Quack'],['🐑','Sheep','Baa'],['🐴','Horse','Neigh'],['🐝','Bee','Buzz'],['🐍','Snake','Hiss'],['🦁','Lion','Roar']];

// ── Colour Magic paintings ──
export const PC: [hex: string, name: string][] = [['#FF4D4D','red'],['#FFD43B','yellow'],['#3B82F6','blue'],['#22C55E','green'],['#FF8A1F','orange'],['#A855F7','purple'],['#8B5A2B','brown'],['#FF8FB1','pink'],['#333333','black']];
const rc = (x: number, y: number, w: number, h: number, r = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
const ci = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;
const el = (x: number, y: number, a: number, b: number) => `<ellipse cx="${x}" cy="${y}" rx="${a}" ry="${b}"/>`;
const po = (p: string) => `<polygon points="${p}"/>`;
const pa = (d: string) => `<path d="${d}"/>`;
const gr = (...a: string[]) => `<g>${a.join('')}</g>`;
const SKY = rc(0, 0, 200, 200), GR = rc(0, 150, 200, 50);
const ARC = (r: number) => pa(`M${100 - r} 160a${r} ${r} 0 0 1 ${2 * r} 0z`);
export type ArtPart = [colours: string, svg: string]; // "red|pink" = one of these is chosen at random each round
export type Art = [name: string, parts: ArtPart[]];
// Earlier parts are the background; they come pre-painted for the youngest class.
export const ART: Art[] = [
['House',[['blue',SKY],['green',GR],['brown',rc(125,55,16,38)],['yellow|orange|pink',rc(45,95,110,70)],['red|purple|brown',po('35,98 100,45 165,98')],['brown|blue',rc(88,125,26,40)],['blue|yellow',rc(56,108,24,22)],['yellow',ci(170,28,16)]]],
['Apple tree',[['blue',SKY],['green',GR],['brown',rc(88,100,24,60)],['green|orange',ci(100,75,48)],['red',ci(80,70,9)],['red|yellow',ci(118,88,9)],['red|orange',ci(96,100,9)],['yellow',ci(30,30,18)]]],
['Flower',[['blue',SKY],['green',rc(0,155,200,45)],['green',rc(96,75,8,85)],['green',el(76,125,22,9)],['orange|brown|red',pa('M68 150h64l-9 38H77z')],['pink|red|purple|orange',gr(ci(100,38,20),ci(100,82,20),ci(78,60,20),ci(122,60,20))],['yellow|brown',ci(100,60,15)]]],
['Fish tank',[['blue|green',SKY],['yellow|orange',rc(0,160,200,40)],['green',pa('M30 165q-10-35 5-60q5 30 15 60zM160 165q10-30 0-55q-10 25-10 55z')],['orange|red|purple',el(95,95,48,30)],['yellow|pink|purple',po('138,95 178,68 178,122')],['blue|purple|red',pa('M80 68q15-24 35 0z')],['black',ci(72,88,5)]]],
['Car',[['blue',SKY],['green',rc(0,135,200,65)],['black|brown',rc(0,155,200,30)],['red|blue|orange|green|purple',rc(25,95,150,45,12)],['red|blue|orange|green|purple',pa('M60 95l22-32h36l22 32z')],['yellow|blue',pa('M72 93l15-24h26l15 24z')],['yellow',ci(168,112,7)],['black',gr(ci(65,142,17),ci(135,142,17))]]],
['Boat',[['blue',SKY],['yellow',ci(165,35,18)],['yellow|red|pink',po('100,28 100,105 150,105')],['red|green|orange',po('94,40 94,105 55,105')],['brown|red|purple',pa('M40 110h120l-22 38H62z')],['blue|green',rc(0,145,200,55)],['pink|purple|red',po('100,28 100,44 120,36')]]],
['Ice cream',[['yellow|pink|blue',SKY],['brown|orange',po('68,105 132,105 100,185')],['pink|purple|yellow',ci(100,88,32)],['green|red',gr(ci(88,90,4),ci(110,84,4),ci(100,100,4))],['purple|pink|green',ci(100,62,26)],['yellow|pink|orange',ci(100,40,19)],['red',ci(100,20,8)]]],
['Rocket',[['purple|blue|black',SKY],['yellow',ci(30,40,10)],['yellow',ci(170,60,8)],['red|blue|green',pa('M100 25q40 40 30 110H70q-10-70 30-110z')],['orange|yellow|red',pa('M100 25q14 14 22 32H78q8-18 22-32z')],['blue|yellow',ci(100,90,16)],['blue|purple|green',po('70,110 45,150 70,135')],['blue|purple|green',po('130,110 155,150 130,135')],['orange|yellow|red',pa('M82 135h36l-18 40z')]]],
['Butterfly',[['green|blue|yellow',SKY],['pink|orange|purple',el(70,78,34,30)],['pink|orange|purple',el(130,78,34,30)],['yellow|blue|red',el(78,125,26,24)],['yellow|blue|red',el(122,125,26,24)],['red|purple|blue',ci(70,78,10)],['red|purple|blue',ci(130,78,10)],['brown|black',rc(94,60,12,90,6)]]],
['Castle',[['blue',SKY],['green',GR],['brown|purple|orange',rc(55,85,90,70)],['brown|purple|orange',rc(38,60,28,95)],['brown|purple|orange',rc(134,60,28,95)],['red|purple|blue',po('34,62 52,35 70,62')],['red|purple|blue',po('130,62 148,35 166,62')],['brown|blue',pa('M88 155v-28a12 12 0 0 1 24 0v28z')]]],
['Rainbow',[['blue',SKY],['green',rc(0,160,200,40)],['red|pink',ARC(90)],['orange',ARC(76)],['yellow',ARC(62)],['green',ARC(48)],['purple',ARC(34)]]],
['Duck',[['blue|green',SKY],['green',rc(0,165,200,35)],['yellow|orange|pink',el(100,120,50,38)],['yellow|orange|pink',ci(130,70,28)],['orange|red',po('153,72 182,80 153,88')],['black',ci(138,64,5)],['orange|brown|yellow',pa('M65 118q25-25 45 10q-25 20-45-10z')]]],
];
