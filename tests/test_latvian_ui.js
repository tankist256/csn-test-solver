const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "../solver/index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../solver/app.js"), "utf8");
const solverFiles = ["serve.py", "job_queue.py", "collector.py", "thumbnails.py"].map((name) =>
  fs.readFileSync(path.join(__dirname, "../solver", name), "utf8"),
);
const userFacingFiles = [
  "../parser.py",
  "../deploy/collector-job.py",
  "../deploy/collector-worker.py",
  "../deploy/update-from-github.sh",
].map((name) => fs.readFileSync(path.join(__dirname, name), "utf8"));
const syncScript = fs.readFileSync(path.join(__dirname, "../deploy/collect-and-sync.sh"), "utf8");
const dataSyncScript = fs.readFileSync(path.join(__dirname, "../deploy/apply-data-sync.py"), "utf8");
const visibleHtml = html.replace(/<!--[\s\S]*?-->/g, "");

function readComments(file, source) {
  if (file.endsWith(".html")) return [...source.matchAll(/<!--[\s\S]*?-->/g)].map((match) => match[0]);
  if (file.endsWith(".css")) return [...source.matchAll(/\/\*[\s\S]*?\*\//g)].map((match) => match[0]);
  if (file.endsWith(".js")) return source.match(/(?:^|[\s;])\/\/[ \t]?.*$/gm) || [];
  return source.match(/^\s*#.*$/gm) || [];
}

test("uses Latvian page metadata", () => {
  assert.match(html, /<html lang="lv"/);
  assert.match(html, /<title>CSDD teorija — B kategorijas jautājumi<\/title>/);
});

test("keeps every static page control in Latvian", () => {
  for (const label of [
    "Atbilžu lapa",
    "Mainīt krāsu režīmu",
    "Papildināt jautājumu datubāzi",
    "Meklēt jautājumu vai atbildi…",
    "Meklēt jautājumus un atbildes",
    "Visi",
    "Ar attēliem",
    "Izlase",
    "Ielādē…",
    "Parādīt vēl",
    "Jautājumu lapas",
    "Iepriekšējā",
    "Nākamā",
    "Jautājums un atbilžu varianti",
    "Oficiālais CSDD tests",
    "Datubāzes papildināšana",
    "Ievadiet administratora atslēgu",
    "Sākt jautājumu ievākšanu",
    "Ceļu satiksmes situācijas attēls",
  ]) {
    assert.ok(visibleHtml.includes(label), `missing Latvian label: ${label}`);
  }
  assert.doesNotMatch(visibleHtml, /[А-Яа-яЁё]/, "visible HTML must not contain Russian text");
});

test("does not load a language switcher or localization system", () => {
  assert.doesNotMatch(html, /language-select|lang-switch|i18n\.js|locales\.js/i);
  assert.equal(fs.existsSync(path.join(__dirname, "../solver/i18n.js")), false);
  assert.match(html, /<script src="questions\.js"><\/script>/);
  assert.match(html, /<script src="app\.js"><\/script>/);
});

test("keeps browser interface copy in Latvian", () => {
  assert.doesNotMatch(app, /[А-Яа-яЁё]/);
  assert.match(app, /toLocaleString\("lv-LV"\)/);
  for (const source of solverFiles) assert.doesNotMatch(source, /[А-Яа-яЁё]/);
  for (const source of userFacingFiles) assert.doesNotMatch(source, /[А-Яа-яЁё]/);
  assert.match(syncScript, /Azure datubāze atbilst vietējai kopijai/);
  assert.doesNotMatch(syncScript, /Azure question database matches/i);
  for (const phrase of ["Python environment missing", "Azure SSH key missing", "Another collection or sync", "Usage:"]) {
    assert.doesNotMatch(syncScript, new RegExp(phrase, "i"));
  }
  assert.match(dataSyncScript, /Instalēti \{count\} jautājumi/);
  for (const phrase of [
    "Installed {count} questions",
    "Unexpected upload directory",
    "Question files are missing",
    "Question database is empty",
    "questions.js does not match",
    "A question is incomplete",
    "Missing media file",
    "Usage: apply-data-sync.py",
  ]) {
    assert.doesNotMatch(dataSyncScript, new RegExp(phrase, "i"));
  }
});

test("keeps every README in English", () => {
  for (const file of ["../README.md", "../solver/README.md", "../deploy/README.md"]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.match(source, /^# [A-Za-z]/, `${file} must start with an English title`);
    assert.doesNotMatch(source, /[А-Яа-яЁё]/, `${file} must not contain Russian text`);
  }
});

test("keeps code comments in English", () => {
  const files = [
    "../solver/index.html",
    "../solver/app.js",
    "../solver/style.css",
    "../solver/serve.py",
    "../solver/job_queue.py",
    "../solver/collector.py",
    "../solver/thumbnails.py",
    "../parser.py",
    "../Dockerfile",
    "../docker-compose.yml",
    "../.gitignore",
    "../deploy/apply-data-sync.py",
    "../deploy/collect-and-sync.sh",
    "../deploy/collector-job.py",
    "../deploy/collector-worker.py",
    "../deploy/update-from-github.sh",
    "../deploy/certbot/reload-nginx.sh",
    "./test_collector_ui.js",
    "./test_latvian_ui.js",
    "./test_job_queue.py",
    "./test_serve.py",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    const comments = readComments(file, source);
    assert.doesNotMatch(comments.join("\n"), /[А-Яа-яЁё]/, `${file} has a non-English comment`);
  }
});
