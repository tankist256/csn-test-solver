import fs from "node:fs";

const pagePath = "solver/dist/index.html";
let html = fs.readFileSync(pagePath, "utf8");
const sourceEntry = 'app.src = "/src/main.jsx";';
const standaloneEntry = 'app.src = "dist/standalone/standalone.js";';
if (!html.includes(sourceEntry) || !html.includes(standaloneEntry)) {
  throw new Error("The React entry points were not found in solver/dist/index.html.");
}
const appEntries = fs.readdirSync("solver/dist/assets")
  .filter((name) => /^app-[\w-]+\.js$/.test(name));
if (appEntries.length !== 1) {
  throw new Error("Expected exactly one versioned React entry point.");
}
html = html.replace(sourceEntry, `app.src = "./assets/${appEntries[0]}";`);
fs.writeFileSync(pagePath, html);
