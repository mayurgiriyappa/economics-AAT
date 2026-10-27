const fs = require('fs');

const html = fs.readFileSync('dashboard.html', 'utf8');

// Parse all elements with id from html
const idMap = {};
const elemRegex = /<([a-zA-Z0-9]+)[^>]*id=["']([^"']+)["'][^>]*>/g;
let m;
while ((m = elemRegex.exec(html)) !== null) {
  const tag = m[1];
  const id = m[2];
  idMap[id] = {
    tagName: tag.toUpperCase(),
    id: id,
    textContent: '',
    innerHTML: '',
    value: '',
    style: {},
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    addEventListener(evt, fn) {},
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
}

console.log('Parsed', Object.keys(idMap).length, 'elements with IDs');

// Check document.getElementById
const scriptContent = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const windowMock = {
  scrollTo() {},
  addEventListener() {},
  clearTimeout() {},
  setTimeout() {},
  location: { origin: 'http://localhost' },
  _toastTimer: null
};

const docMock = {
  getElementById(id) {
    if (!idMap[id]) {
      console.warn('document.getElementById NOT FOUND:', id);
      return null;
    }
    return idMap[id];
  },
  querySelectorAll(sel) {
    return [];
  },
  querySelector(sel) {
    return null;
  },
  body: { appendChild() {} },
  createElement() {
    return { setAttribute() {}, click() {}, remove() {} };
  }
};

const localStorageMock = {
  getItem() { return null; },
  setItem() {}
};

try {
  const fn = new Function('window', 'document', 'localStorage', 'location', scriptContent);
  fn(windowMock, docMock, localStorageMock, windowMock.location);
  console.log('Finished running script with real IDs!');
} catch (e) {
  console.error('ERROR during script execution:', e);
}
