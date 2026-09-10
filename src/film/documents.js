import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const LIMIT = 4 * 1024 * 1024;
function xml(text) {
  if (text.length > LIMIT || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Oversized XML or entity declarations are not supported.');
  if (XMLValidator.validate(text) !== true) throw new Error('Document contains invalid XML.');
  return new XMLParser({ preserveOrder: true, ignoreAttributes: false, processEntities: true, trimValues: false, parseTagValue: false }).parse(text);
}
function content(nodes) {
  return (nodes || []).map(node => Object.entries(node).filter(([k])=>k!==':@').map(([key,value])=>key==='#text'?String(value):['w:br','w:cr'].includes(key)?'\n':key==='w:tab'?'\t':Array.isArray(value)?content(value):'').join('')).join('');
}
function elements(nodes, tag) {
  return (nodes || []).flatMap(node => Object.entries(node).filter(([key])=>key!==':@').flatMap(([key,value])=>key===tag?[{nodes:value,attributes:node[':@']||{}}]:Array.isArray(value)?elements(value,tag):[]));
}
export function extractDocument(bytes, filename) {
  const ext=filename.split('.').pop().toLowerCase();
  if(['txt','md','fdx'].includes(ext)) {
    const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(ext!=='fdx')return {text:raw,method:'utf8-original',warnings:[]};
    const parsed=xml(raw);
    if(!elements(parsed,'FinalDraft').length)throw new Error('Not a Final Draft FDX document.');
    const paragraphs=elements(parsed,'Paragraph').map(p=>{
      const value=content(p.nodes);const type=p.attributes['@_Type'];
      return type==='Character'?value.toUpperCase():type==='Parenthetical'?`(${value.replace(/^\(|\)$/g,'')})`:type==='Scene Heading'?`\n${value}\n`:type==='Action'?`${value}\n`:value;
    });
    return {text:paragraphs.join('\n'),method:'fdx-paragraphs',warnings:['Line locations refer to extracted paragraphs. Verify FDX page boundaries.']};
  }
  if(ext==='docx') {
    let oversized=false;
    const files=unzipSync(bytes,{filter:file=>{if(file.name!=='word/document.xml')return false;if(file.originalSize>LIMIT){oversized=true;return false;}return true;}});
    if(oversized || !files['word/document.xml'])throw new Error('DOCX is missing a bounded word/document.xml.');
    const parsed=xml(strFromU8(files['word/document.xml']));
    return {text:elements(parsed,'w:p').map(p=>content(p.nodes)).join('\n'),method:'docx-paragraphs',warnings:['DOCX paragraph locations are exact; pagination is an estimate. Review tables and screenplay layout.']};
  }
  throw new Error('This source needs browser PDF extraction or a transcription runner.');
}

export async function extractPdf(bytes, library) {
  const task=library.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true});
  let document;
  try {
    document=await task.promise;
    if(document.numPages>350)throw new Error('PDF exceeds the 350-page import limit.');
    const pages=[];
    for(let n=1;n<=document.numPages;n++) {
      const page=await document.getPage(n);const result=await page.getTextContent();
      let previousY=null;let previousX=0;let line='';const lines=[];
      for(const item of result.items) {
        if(!('str' in item))continue;
        const y=item.transform[5], x=item.transform[4];
        if(previousY!==null && Math.abs(y-previousY)>3){lines.push(line);if(Math.abs(y-previousY)>20)lines.push('');line='';previousX=0;}
        line+=`${line&&!/\s$/.test(line)&&!/^\s/.test(item.str)&&x>previousX+1?' ':''}${item.str}`;previousY=y;previousX=x+item.width;
        if(item.hasEOL){lines.push(line);line='';previousY=null;}
      }
      if(line)lines.push(line);pages.push(lines.join('\n'));
      if(pages.join('\n').length>350000)throw new Error('Extracted PDF text exceeds the script limit.');
    }
    const text=pages.join('\n\f\n');
    if(!text.trim())throw new Error('This PDF has no extractable text. Upload a text-based script or an OCR transcript.');
    return {text,method:'pdf-text-layer',warnings:['Review PDF reading order, especially dual dialogue. Scanned PDFs require OCR.']};
  } finally { await task.destroy(); }
}
