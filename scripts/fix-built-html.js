import fs from "node:fs";

const pagePath = "solver/dist/index.html";
let html = fs.readFileSync(pagePath, "utf8");
const sourceEntry = 'app.src = "/src/main.jsx";';
const standaloneEntry = 'app.src = "dist/standalone/standalone.js";';
if (!html.includes(sourceEntry) || !html.includes(standaloneEntry)) {
  throw new Error("The React entry points were not found in solver/dist/index.html.");
}
html = html.replace(sourceEntry, 'app.src = "./assets/app.js";');
fs.writeFileSync(pagePath, html);
