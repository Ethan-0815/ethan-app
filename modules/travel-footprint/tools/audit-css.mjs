/* tools/audit-css.mjs — list page classes that have no styles yet. */
import fs from 'node:fs';

const files = ['home', 'map', 'timeline', 'cities', 'city'].map((n) => `app/js/ui/pages/${n}.js`);
const extra = ['app/js/ui/flows.js', 'app/js/ui/parts.js', 'app/js/ui/app.js'];

const used = new Set();

function harvest(src) {
  // h('div.cls.cls2', …)
  const re = /h\('([a-z0-9]+)((?:\.[a-zA-Z0-9_-]+)*)'/g;
  let m;
  while ((m = re.exec(src))) {
    m[2].split('.').filter(Boolean).forEach((c) => used.add(c));
  }
  // class: 'a b c'
  const re2 = /class:\s*'([^']*)'/g;
  while ((m = re2.exec(src))) {
    m[1].split(/\s+/).filter(Boolean).forEach((c) => used.add(c));
  }
  // class="a b" inside template/html strings
  const re3 = /class="([a-zA-Z0-9 _-]+)"/g;
  while ((m = re3.exec(src))) {
    m[1].split(/\s+/).filter(Boolean).forEach((c) => used.add(c));
  }
}

files.forEach((f) => fs.existsSync(f) && harvest(fs.readFileSync(f, 'utf8')));
extra.forEach((f) => fs.existsSync(f) && harvest(fs.readFileSync(f, 'utf8')));

const css =
  fs.readFileSync('app/css/base.css', 'utf8') +
  fs.readFileSync('app/css/components.css', 'utf8') +
  fs.readFileSync('app/css/layout.css', 'utf8');

const styled = new Set();
const re2 = /\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
let m2;
while ((m2 = re2.exec(css))) styled.add(m2[1]);

const missing = [...used]
  .filter((c) => !styled.has(c) && !c.startsWith('u-') && !c.startsWith('t-'))
  .sort();

console.log(`\nUNSTYLED (${missing.length}):`);
console.log(missing.join('\n'));

// also report styles defined but never used (dead CSS)
const allDefined = new Set();
const re3 = /^\.([a-zA-Z][a-zA-Z0-9_-]*)/gm;
while ((m2 = re3.exec(css))) allDefined.add(m2[1]);

const dead = [...allDefined].filter((c) => !used.has(c)).sort();
console.log(`\nDEFINED BUT UNUSED (${dead.length}):`);
console.log(dead.join('\n'));
