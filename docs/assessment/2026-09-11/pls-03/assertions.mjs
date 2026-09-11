import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const baseline='a9228de32b941f2658491c7ff32cba56c3542598';
const oldPath='test/contract/honest-standin.test.ts';
const paths=[oldPath,'test/contract/honest-standin-window.test.ts'];
function assertions(file,text){const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);const out=[];function walk(n){if(ts.isCallExpression(n)&&n.expression.getText(sf).startsWith('assert.'))out.push({line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,text:n.getText(sf)});ts.forEachChild(n,walk);}walk(sf);return out;}
const old=assertions(oldPath,execFileSync('git',['show',baseline+':'+oldPath],{encoding:'utf8'}));
const now=paths.flatMap(p=>assertions(p,readFileSync(p,'utf8')).map(x=>({...x,path:p})));
const mapping=old.map(x=>({old:{path:oldPath,line:x.line},assertion:x.text,current:now.filter(n=>n.text===x.text).map(n=>({path:n.path,line:n.line,level:n.path.includes('-window')?'L3':'L2'}))}));
if(mapping.some(m=>!m.current.length))throw new Error(JSON.stringify(mapping.filter(m=>!m.current.length)));
writeFileSync('docs/assessment/2026-09-11/pls-03/assertion-mapping.json',JSON.stringify({baseline,originalAssertions:old.length,allPreserved:true,mapping},null,2)+'\n');
console.log(`${old.length} original assertions preserved in L2/L3`);
