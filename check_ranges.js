const fs = require('fs');

function inspectRanges(filename) {
  const content = fs.readFileSync(filename, 'utf8');
  console.log(`=== ${filename} ===`);
  const regex = /<input[^>]*type=["']range["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    console.log(match[0]);
  }
}

inspectRanges('index.html');
inspectRanges('dashboard.html');
