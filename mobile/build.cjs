// Builds dist/worker.js: the Worker plus the page files embedded as strings (one file to paste/upload).
const fs = require('fs'), path = require('path');
const S = f => path.join(__dirname, 'src', f);
const uri = f => 'data:image/png;base64,' + fs.readFileSync(S(f)).toString('base64');
const sub = t => t.replace(/__ICON180__/g, uri('icon180.png')).replace(/__ICON192__/g, uri('icon192.png')).replace(/__ICON512__/g, uri('icon512.png'));
const assets = { '/': sub(fs.readFileSync(S('index.html'), 'utf8')), '/app.js': fs.readFileSync(S('app.js'), 'utf8'), '/app.css': fs.readFileSync(S('app.css'), 'utf8'), '/manifest.webmanifest': sub(fs.readFileSync(S('manifest.webmanifest'), 'utf8')) };
let w = fs.readFileSync(S('worker.js'), 'utf8').replace(/typeof ASSETS !== 'undefined' && /, '');
w = w.replace('// ASSETS is filled in by build.js.', 'const ASSETS = ' + JSON.stringify(assets) + ';');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true }); fs.writeFileSync(path.join(__dirname, 'dist', 'worker.js'), w);
console.log('dist/worker.js', Math.round(w.length / 1024) + ' KB');
