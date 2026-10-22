import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("solver/index.html");
const reactFiles = fs.readdirSync(path.join(root, "solver/src"), { recursive: true })
  .filter((file) => /\.(jsx|js)$/.test(file))
  .map((file) => read(path.join("solver/src", file)));
const combinedReact = reactFiles.join("\n");

function readComments(file, source) {
  if (file.endsWith(".html")) return [...source.matchAll(/<!--[\s\S]*?-->/g)].map((match) => match[0]);
  if (file.endsWith(".css")) return [...source.matchAll(/\/\*[\s\S]*?\*\//g)].map((match) => match[0]);
  if (file.endsWith(".js") || file.endsWith(".jsx")) return source.match(/(?:^|[\s;])\/\/[^\n]*/gm) || [];
  return source.match(/^\s*#.*$/gm) || [];
}

test("uses Latvian page metadata and the React entry point", () => {
  assert.match(html, /<html lang="lv"/);
  assert.match(html, /<title>CSDD teorija — B kategorijas jautājumi<\/title>/);
  assert.match(html, /id="root"/);
  assert.match(html, /app\.src = "\/src\/main\.jsx"/);
  assert.match(html, /app\.src = "dist\/standalone\/standalone\.js"/);
  assert.match(html, /questions\.js/);
  assert.doesNotMatch(html, /[А-Яа-яЁё]/);
});

test("renders the Latvian interface from React components", () => {
  for (const phrase of [
    "Atbilžu lapa", "Treniņrežīms", "Papildināt jautājumus", "Meklēt jautājumu vai atbildi",
    "Visi jautājumi", "Ar attēliem", "Izlase", "Parādīt vēl jautājumus", "Iepriekšējā",
    "Nākamā", "Jautājums un atbilžu varianti", "Datubāzes papildināšana", "Sākt jautājumu ievākšanu",
  ]) assert.ok(combinedReact.includes(phrase), `missing Latvian label: ${phrase}`);
  assert.doesNotMatch(combinedReact, /[А-Яа-яЁё]/, "React interface text must not contain Russian text");
});

test("preserves local question, preference, bookmark, and collector interfaces", () => {
  assert.match(read("solver/src/App.jsx"), /fetch\("questions\.json"\)/);
  assert.match(read("solver/src/utils/bookmarks.js"), /csdd_bookmarks/);
  assert.match(read("solver/src/App.jsx"), /csdd_mode/);
  assert.match(read("solver/src/App.jsx"), /csdd_theme/);
  assert.match(read("solver/src/components/AdminCollector.jsx"), /\/api\/collector\/access/);
  assert.match(read("solver/src/components/AdminCollector.jsx"), /\/api\/collector\/status/);
  assert.match(read("solver/src/components/AdminCollector.jsx"), /\/api\/collector\/start/);
});

test("keeps public README files in English", () => {
  for (const file of ["README.md", "solver/README.md"]) {
    const source = read(file);
    assert.match(source, /^# [A-Za-z]/, `${file} must start with an English title`);
    assert.doesNotMatch(source, /[А-Яа-яЁё]/, `${file} must not contain Russian text`);
  }
});

test("keeps code comments in English", () => {
  const files = ["solver/index.html", "solver/style.css", "solver/src/App.jsx", ...fs.readdirSync(path.join(root, "solver/src"), { recursive: true }).filter((file) => /\.(jsx|js)$/.test(file)).map((file) => path.join("solver/src", file)), "Dockerfile", "docker-compose.yml", ".gitignore", "tests/test_collector_ui.js", "tests/test_latvian_ui.js"];
  for (const file of files) {
    const comments = readComments(file, read(file));
    assert.doesNotMatch(comments.join("\n"), /[А-Яа-яЁё]/, `${file} has a non-English comment`);
  }
});
