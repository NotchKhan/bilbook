import sharp from 'sharp';
import fs from 'node:fs/promises';
for (const name of ['team','courtyard']) {
 const original=await fs.readFile(`public/demo/${name}.png`);
 const full=await sharp(original).resize({width:1440,height:1440,fit:'inside',withoutEnlargement:true}).webp({quality:76}).toBuffer();
 const thumb=await sharp(original).resize(160,160,{fit:'cover'}).webp({quality:72}).toBuffer();
 await fs.writeFile(`public/demo/${name}.webp`,full);
 await fs.writeFile(`public/demo/${name}-thumb.webp`,thumb);
 console.log(JSON.stringify({name,before:original.length,after:full.length,thumbnail:thumb.length,savedPercent:Math.round(100*(1-full.length/original.length))}));
}
