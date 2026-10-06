const fs = require('fs');
const path = require('path');

const dirs = fs.readdirSync('commands').filter(d => fs.statSync(path.join('commands', d)).isDirectory());

let hardcoded = [];

for (const dir of dirs) {
  const dirPath = path.join('commands', dir);
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const fp = path.join(dirPath, file);
    let c = fs.readFileSync(fp, 'utf8');

    if (!c.includes('COMPONENTS_V2_FLAG')) continue;
    if (c.includes('shouldUseV2')) continue;

    // Count how many times COMPONENTS_V2_FLAG is used (excluding the const definition)
    const count = (c.match(/COMPONENTS_V2_FLAG/g) || []).length;
    hardcoded.push({ file: dir + '/' + file, count });
  }
}

hardcoded.sort((a, b) => b.count - a.count);
console.log('Files with COMPONENTS_V2_FLAG but NO shouldUseV2:');
hardcoded.forEach(f => console.log('  ' + f.file + ' (' + f.count + ' uses)'));
console.log('\nTotal: ' + hardcoded.length);
