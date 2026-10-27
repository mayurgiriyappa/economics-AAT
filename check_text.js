const fs = require('fs');

const index = fs.readFileSync('index.html', 'utf8');
console.log('index.html has "Import vs local":', index.includes('Import vs local'));
console.log('index.html has "Editable assumptions":', index.includes('Editable assumptions'));

const dash = fs.readFileSync('dashboard.html', 'utf8');
console.log('dashboard.html has "Import vs local":', dash.includes('Import vs local'));
console.log('dashboard.html has "Editable assumptions":', dash.includes('Editable assumptions'));
