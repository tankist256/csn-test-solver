import fs from 'node:fs/promises';
import path from 'node:path';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const ROOT = '/Users/xkyota/Development/csn-test-solver';
const BUILD = path.join(ROOT, '.build/presentation');
const OUTPUT = path.join(ROOT, 'output');
const FINAL = path.join(OUTPUT, 'CSDD_teorija_projekta_nedela.pptx');
const W = 1280, H = 720;
const C = {
  navy: '#14264A', navy2: '#1B3768', blue: '#2B63E5', blueLight: '#EAF1FF',
  white: '#FFFFFF', pale: '#F3F6FA', ink: '#15233D', muted: '#63748E',
  line: '#D9E1EC', red: '#E32D2B', green: '#14845C',
};
const FONT = 'Arial';
const pres = Presentation.create({ slideSize: { width: W, height: H } });
pres.theme.defaultFont = FONT;

function shape(slide, geom, name, x, y, w, h, fill = 'none', lineFill = 'none', lineWidth = 0, radius) {
  return slide.shapes.add({
    geometry: geom, name,
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: 'solid', fill: lineFill, width: lineWidth },
    ...(radius ? { borderRadius: radius } : {}),
  });
}
function text(slide, name, value, x, y, w, h, style = {}) {
  const t = shape(slide, 'textbox', name, x, y, w, h);
  t.text = value;
  t.text.insets = 0;
  t.text.style = {
    typeface: FONT,
    fontSize: 22,
    color: C.ink,
    ...style,
  };
  return t;
}
async function imageBytes(p) {
  const b = await fs.readFile(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
async function addImage(slide, p, name, alt, x, y, w, h, fit = 'contain') {
  slide.images.add({
    blob: await imageBytes(p), contentType: 'image/png', name, alt, fit,
    position: { left: x, top: y, width: w, height: h },
    geometry: 'roundRect', borderRadius: 12,
  });
}
function header(slide, title, page) {
  text(slide, `slide-${page}-title`, title, 72, 48, 1120, 58,
    { fontSize: 38, bold: true, color: C.navy });
  shape(slide, 'rect', `slide-${page}-accent`, 72, 121, 64, 5, C.blue);
  text(slide, `slide-${page}-number`, String(page).padStart(2, '0'), 1160, 50, 48, 28,
    { fontSize: 15, bold: true, color: C.muted, alignment: 'right' });
}
function note(slide, lines) { slide.speakerNotes.text = lines.join('\n'); }

// 1 — Minimal cover, using the homepage as product evidence.
{
  const s = pres.slides.add();
  s.background.fill = C.navy;
  shape(s, 'rect', 'cover-red-mark', 74, 86, 72, 10, C.red);
  text(s, 'cover-kicker', 'PROJEKTU NEDĒĻA', 74, 120, 420, 28,
    { fontSize: 16, bold: true, color: '#AFC7FF', charSpacing: 1.5 });
  text(s, 'cover-title', 'CSDD teorija', 74, 186, 470, 82,
    { fontSize: 56, bold: true, color: C.white });
  text(s, 'cover-subtitle', 'Digitāls palīgs B kategorijas teorijas apguvei', 76, 282, 440, 90,
    { fontSize: 26, color: '#D8E2F3' });
  text(s, 'cover-credit', 'Prototips • mācīšanās un zināšanu pārbaude', 76, 610, 500, 32,
    { fontSize: 18, color: '#AFC0DA' });
  await addImage(s,
    '/var/folders/rr/g1yf2sdj31l413vkfr2qkh600000gn/T/codex-clipboard-3c8e3b0a-7ce6-4a71-892c-8ab8e3955f08.png',
    'website-homepage', 'CSDD teorija vietnes sākumlapa', 570, 142, 640, 400, 'cover');
  note(s, ['Atklājiet prezentāciju ar projekta mērķi: palīdzēt B kategorijas vadītājiem mācīties un pārbaudīt zināšanas.',
    'Avots: lietotāja iesniegtais vietnes sākumlapas ekrānattēls.']);
}

// 2 — Goal and learning need.
{
  const s = pres.slides.add(); s.background.fill = C.pale; header(s, 'Mācību mērķis', 2);
  text(s, 'goal-statement', 'Vienā vietā atkārtot teoriju un pārbaudīt savas zināšanas.', 72, 174, 610, 205,
    { fontSize: 43, bold: true, color: C.navy });
  shape(s, 'rect', 'goal-divider', 734, 176, 4, 340, C.blue);
  text(s, 'goal-label', 'RISINĀJUMS', 774, 181, 300, 26,
    { fontSize: 15, bold: true, color: C.blue, charSpacing: 1.2 });
  text(s, 'goal-detail', 'Jautājumu bibliotēka ar pārbaudītām atbildēm un treniņrežīmu ļauj mācīties savā tempā.', 774, 224, 400, 164,
    { fontSize: 27, color: C.ink });
  text(s, 'goal-criterion', 'Prototips risina konkrētu vajadzību: sagatavoties CSDD B kategorijas teorijas eksāmenam.', 774, 431, 398, 100,
    { fontSize: 19, color: C.muted });
  text(s, 'goal-footer', 'IDEJA UN SATURS', 72, 620, 300, 24,
    { fontSize: 15, bold: true, color: C.muted, charSpacing: 1.0 });
  note(s, ['Saistiet risinājumu ar uzdevumu: izglītojamie izstrādā un demonstrē digitālu prototipu.',
    'Vietnes nolūks un atbilžu/treniņa režīmi aprakstīti projektā README un redzami lietotāja ekrānattēlā.']);
}

// 3 — Main functionality with real question bank screenshot.
{
  const s = pres.slides.add(); s.background.fill = C.white; header(s, 'Jautājumu bibliotēka', 3);
  text(s, 'library-lede', 'Meklē, izlasi un pārbaudi sevi.', 72, 169, 360, 90,
    { fontSize: 32, bold: true, color: C.navy });
  text(s, 'library-detail-1', 'Atbildes režīmā redzamas CSDD pārbaudītās atbildes.', 72, 281, 350, 76,
    { fontSize: 21, color: C.ink });
  text(s, 'library-detail-2', 'Treniņrežīmā izvēlies atbildi pats; pareizā atbilde atklājas pēc izvēles.', 72, 383, 350, 105,
    { fontSize: 21, color: C.ink });
  text(s, 'library-stat', '113', 72, 542, 150, 70,
    { fontSize: 50, bold: true, color: C.blue });
  text(s, 'library-stat-label', 'jautājumi redzami iesniegtajā ekrānattēlā', 220, 554, 230, 48,
    { fontSize: 17, color: C.muted });
  await addImage(s,
    '/var/folders/rr/g1yf2sdj31l413vkfr2qkh600000gn/T/codex-clipboard-16ed27e9-11d7-488c-aefd-12ff154d7618.png',
    'question-library', 'Jautājumu bibliotēka ar meklēšanu un atbilžu režīmu', 480, 177, 728, 432, 'contain');
  text(s, 'library-footnote', 'Skaits ņemts no pievienotā ekrānattēla; datubāze var mainīties.', 480, 625, 700, 24,
    { fontSize: 14, color: C.muted });
  note(s, ['Parādiet meklēšanas lauku, attēlu/video filtrus un jautājumu kartītes.',
    'Ekrānattēlā skaitītājs rāda 113 jautājumus, no tiem 12 redzami pašreizējā skatā.',
    'Avots: lietotāja iesniegtais jautājumu bibliotēkas ekrānattēls; funkcijas aprakstītas solver/README.md un solver/src/App.jsx.']);
}

// 4 — Engineering work with repository screenshot.
{
  const s = pres.slides.add(); s.background.fill = C.pale; header(s, 'Izstrāde, pārbaudes un drošība', 4);
  await addImage(s,
    '/var/folders/rr/g1yf2sdj31l413vkfr2qkh600000gn/T/codex-clipboard-c15a17e0-a2e4-430b-8aeb-d11c6b0a985b.png',
    'github-repository', 'GitHub projekta repozitorija ekrānattēls', 72, 170, 628, 405, 'contain');
  text(s, 'repo-caption', 'Repozitorijs GitHub • ekrānā redzami 24 commit un 2 līdzautori', 72, 593, 628, 47,
    { fontSize: 17, color: C.muted });
  text(s, 'engineering-lede', 'Pārbaudāms darba process', 754, 175, 430, 50,
    { fontSize: 28, bold: true, color: C.navy });
  text(s, 'engineering-list', '• Kods un projekta vēsture glabājas GitHub.\n\n• README apraksta palaišanu un funkcijas.\n\n• Testu faili aptver saskarni, serveri, kontus un kolektoru.\n\n• Pareiza atbilde tiek rādīta tikai pēc pārbaudes CSDD.', 754, 250, 440, 335,
    { fontSize: 19, color: C.ink });
  shape(s, 'rect', 'engineering-rule', 754, 613, 410, 2, C.line);
  text(s, 'engineering-admin', 'Jautājumu ievākšana serverī pieejama administratoram.', 754, 630, 430, 48,
    { fontSize: 16, color: C.muted });
  note(s, ['Paskaidrojiet, ka Git nodrošina versiju vēsturi un repo redzamie commit ir projekta darba pēdas; ekrānattēlā redzami 24 commit un 2 līdzautori.',
    'README apraksta palaišanu un funkcijas. Testu faili aptver UI, serveri, autentifikāciju, darba rindas un kolektoru.',
    'Drošība: README norāda, ka datu ievākšanai vajadzīga administratora sesija; atbilde netiek atzīmēta pareiza, kamēr nav pārbaudīta pret CSDD pārskata lapu.',
    'Avoti: README.md, solver/README.md, solver/src/components/QuestionCard.jsx, solver/api.py.']);
}

// 5 — Azure proof, cropped to exclude account and subscription identifiers.
{
  const s = pres.slides.add(); s.background.fill = C.white; header(s, 'Palaišana Azure vidē', 5);
  text(s, 'azure-lede', 'Azure ekrānattēlā redzama palaista virtuālā mašīna.', 72, 169, 430, 120,
    { fontSize: 31, bold: true, color: C.navy });
  text(s, 'azure-facts', 'csn-solver\nUbuntu 24.04\nSweden Central', 72, 333, 340, 152,
    { fontSize: 24, color: C.ink });
  text(s, 'azure-running', 'VM statuss ekrānattēlā: Running', 72, 540, 380, 42,
    { fontSize: 20, bold: true, color: C.green });
  await addImage(s, path.join(BUILD, 'azure-overview-cropped.png'), 'azure-vm',
    'Azure virtuālās mašīnas pārskats; personas un abonementa identifikatori izgriezti',
    560, 220, 620, 400, 'contain');
  text(s, 'azure-footnote', 'Attēls rāda Azure VM statusu ekrānuzņēmuma uzņemšanas brīdī.', 560, 635, 620, 32,
    { fontSize: 15, color: C.muted });
  note(s, ['Azure ekrānattēls apliecina csn-solver virtuālās mašīnas statusu Running un norāda Ubuntu 24.04, 2 vCPU, 1 GiB RAM un Sweden Central.',
    'Ekrānattēlā redzamais izveides datums ir 15.10.2026 (UTC).',
    'Ekrānattēla apgriezums izslēdz konta e-pastu un abonementa ID. Tas apliecina VM stāvokli attēla uzņemšanas brīdī, nevis pašreizēju pieejamību.']);
}

// 6 — Close with a concise live-demo sequence.
{
  const s = pres.slides.add(); s.background.fill = C.navy;
  text(s, 'close-kicker', 'PROJEKTA NEDĒĻAS REZULTĀTS', 72, 62, 600, 30,
    { fontSize: 16, bold: true, color: '#AFC7FF', charSpacing: 1.4 });
  text(s, 'close-title', 'Pārbaudāms digitāls prototips', 72, 124, 1080, 68,
    { fontSize: 43, bold: true, color: C.white });
  text(s, 'close-summary', 'Vietne apvieno jautājumu bibliotēku, CSDD pārbaudītas atbildes un pašpārbaudes režīmu.', 72, 223, 970, 85,
    { fontSize: 25, color: '#D8E2F3' });
  shape(s, 'rect', 'close-divider', 72, 350, 1128, 2, '#36517A');
  text(s, 'demo-heading', 'Dzīvā demonstrācija', 72, 389, 340, 46,
    { fontSize: 25, bold: true, color: C.white });
  text(s, 'demo-steps', '01   Atver jautājumu bibliotēku un meklē noteikumu jautājumu.\n\n02   Parādi CSDD pārbaudīto atbildi un ar attēlu saistītu situāciju.\n\n03   Pārslēdz treniņrežīmu un izvēlies atbildi.', 72, 453, 1060, 190,
    { fontSize: 20, color: '#D8E2F3' });
  shape(s, 'rect', 'close-red-mark', 72, 673, 54, 7, C.red);
  note(s, ['Noslēdziet ar īsu vietnes demonstrāciju. 3. darbībā pareizās/incorrectās izvēles uzvedība redzama jautājuma kartītē; atbilžu izvēle ir pieejama verificētiem jautājumiem.',
    'Šī secība ir ieteikums prezentētājam, nevis apgalvojums, ka tieši šāds demos jau ir veikts.']);
}

await fs.mkdir(BUILD, { recursive: true });
await fs.mkdir(OUTPUT, { recursive: true });
for (const [index, slide] of pres.slides.items.entries()) {
  const blob = await pres.export({ slide, format: 'png', scale: 1 });
  await fs.writeFile(path.join(BUILD, `slide-${String(index + 1).padStart(2, '0')}.png`), new Uint8Array(await blob.arrayBuffer()));
}
const pptx = await PresentationFile.exportPptx(pres);
const draftPath = path.join(BUILD, 'draft.pptx');
await pptx.save(draftPath);
console.log(JSON.stringify({ draftPath, finalPath: FINAL, slides: pres.slides.items.length }));
