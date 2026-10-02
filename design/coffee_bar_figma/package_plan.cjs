const fs=require('fs');
const path=require('path');
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'layout-data.json'),'utf8'));
const out=path.join(__dirname,'native-figma-importer');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'code.js'),'const DATA = '+JSON.stringify(data)+';\n'+fs.readFileSync(path.join(__dirname,'native-importer-template.js'),'utf8'));
console.log('Packaged native Figma importer with '+data.layers.length+' layers.');
