const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');

// Find all id="..." in HTML before <script>
const scriptStart = html.indexOf('<script>');
const htmlBody = html.slice(0, scriptStart);

const idRegex = /id=["']([^"']+)["']/g;
const htmlIds = new Set();
let m;
while ((m = idRegex.exec(htmlBody)) !== null) {
  htmlIds.add(m[1]);
}

// Find all document.getElementById('...') in script
const scriptContent = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const getElemRegex = /document\.getElementById\(['"]([^'"]+)['"]\)/g;
const scriptIds = new Set();
while ((m = getElemRegex.exec(scriptContent)) !== null) {
  scriptIds.add(m[1]);
}

console.log('Script references', scriptIds.size, 'distinct IDs');
const missing = [];
for (const id of scriptIds) {
  if (!htmlIds.has(id)) {
    missing.push(id);
  }
}

console.log('Total HTML IDs found:', htmlIds.size);
if (missing.length > 0) {
  console.log('MISSING IDs in HTML that script tries to getElementById on:');
  missing.forEach(id => console.log(' - ' + id));
} else {
  console.log('All script getElementById IDs exist in HTML!');
}
