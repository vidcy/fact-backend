const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const distMain = path.join(distDir, 'main.js');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.writeFileSync(distMain, "require('./src/main.js');\n", 'utf8');
console.log('✅ Created dist/main.js proxy -> dist/src/main.js');
