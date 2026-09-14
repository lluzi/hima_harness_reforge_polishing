#!/usr/bin/env python3
"""Build the evaluation PDF and offline HTML from the reviewed Markdown source.
No application, model or EDA execution. Requires reportlab and a CJK TrueType font.
"""
import csv
import html
import json
import os
from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Flowable, Frame,
    PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle)

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'output/pdf'
OUT.mkdir(parents=True, exist_ok=True)
FONT = Path(os.environ.get('HIMA_MANUAL_CJK_FONT', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'))
if not FONT.is_file():
    raise SystemExit('Set HIMA_MANUAL_CJK_FONT to a CJK TrueType font; no font is downloaded automatically.')
pdfmetrics.registerFont(TTFont('CJK', str(FONT)))
pdfmetrics.registerFontFamily('CJK', normal='CJK', bold='CJK', italic='CJK', boldItalic='CJK')
INK = colors.HexColor('#17212D')
PURPLE = colors.HexColor('#6553B9')
MUTED = colors.HexColor('#586373')
LIGHT = colors.HexColor('#F3F2F8')
BORDER = colors.HexColor('#DADDE4')
PAGE_W, PAGE_H = 210 * mm, 297 * mm
WIDTH = PAGE_W - 36 * mm
styles = {
    'body': ParagraphStyle('body', fontName='CJK', fontSize=10.2, leading=16.1,
        textColor=INK, spaceAfter=8, wordWrap='CJK', splitLongWords=True),
    'small': ParagraphStyle('small', fontName='CJK', fontSize=8.3, leading=12.2,
        textColor=MUTED, spaceAfter=5, wordWrap='CJK', splitLongWords=True),
    'h2': ParagraphStyle('h2', fontName='CJK', fontSize=21, leading=30,
        textColor=INK, spaceAfter=16, keepWithNext=True, wordWrap='CJK'),
    'h3': ParagraphStyle('h3', fontName='CJK', fontSize=12.2, leading=19,
        textColor=PURPLE, spaceBefore=6, spaceAfter=8, keepWithNext=True, wordWrap='CJK'),
    'code': ParagraphStyle('code', fontName='CJK', fontSize=8.8, leading=13.4,
        textColor=INK, wordWrap='CJK', splitLongWords=True, spaceAfter=0),
    'cell': ParagraphStyle('cell', fontName='CJK', fontSize=9, leading=13.2,
        textColor=INK, wordWrap='CJK', splitLongWords=True),
    'th': ParagraphStyle('th', fontName='CJK', fontSize=9, leading=13.2,
        textColor=colors.white, wordWrap='CJK'),
}


def inline(value, pdf=False):
    pattern = re.compile(r'(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)')
    output = []
    for token in pattern.split(value):
        if token.startswith('`') and token.endswith('`'):
            v = html.escape(token[1:-1])
            output.append(f'<font color="#5946A5">{v}</font>' if pdf else f'<code>{v}</code>')
        elif token.startswith('[') and '](' in token:
            label, target = token[1:].split('](', 1)
            target = html.escape(target[:-1], quote=True)
            tag = 'link' if pdf else 'a'
            output.append(f'<{tag} href="{target}">{html.escape(label)}</{tag}>')
        elif token.startswith('**') and token.endswith('**'):
            v = html.escape(token[2:-2])
            output.append(f'<font color="#493984">{v}</font>' if pdf else f'<strong>{v}</strong>')
        else:
            output.append(html.escape(token))
    return ''.join(output)


def blocks(text):
    lines = text.splitlines()
    result = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith('```'):
            code = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                code.append(lines[i]); i += 1
            result.append(('code', '\n'.join(code))); i += 1
        elif line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                cells = [x.strip() for x in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?', x) for x in cells):
                    rows.append(cells)
                i += 1
            result.append(('table', rows))
        elif line.startswith('### '):
            result.append(('h3', line[4:])); i += 1
        elif line.startswith('> '):
            result.append(('callout', line[2:])); i += 1
        else:
            para = [line]
            i += 1
            while i < len(lines) and lines[i].strip() and not lines[i].startswith(('|', '```', '### ', '> ')):
                para.append(lines[i].strip()); i += 1
            # Preserve numbered and bullet lists as separate paragraphs.
            for segment in re.split(r'\n(?=(?:\d+\.|-) )', '\n'.join(para)):
                result.append(('p', segment.replace('\n', ' ')))
    return result


class InterfaceMap(Flowable):
    def __init__(self):
        super().__init__(); self.width = WIDTH; self.height = 124
    def draw(self):
        c = self.canv
        panels = [(0, 26, 100, 82, '① 工作区 / 会话'),
                  (108, 26, 198, 82, '② 对话与行动'),
                  (314, 26, WIDTH - 314, 82, '③ 运行 / ④ 结果')]
        for x, y, w, h, title in panels:
            c.setFillColor(LIGHT); c.setStrokeColor(BORDER)
            c.roundRect(x, y, w, h, 6, fill=1, stroke=1)
            c.setFillColor(INK); c.setFont('CJK', 9.8); c.drawString(x + 9, y + h - 20, title)
        c.setFillColor(MUTED); c.setFont('CJK', 8)
        c.drawString(9, 62, '选择项目与过去的对话')
        c.drawString(117, 62, '提问、约束、代码与工具记录')
        c.drawString(323, 62, 'Live Run / Report')
        c.drawString(323, 43, '⑤ Files & code / 资产')
        c.drawString(0, 9, '界面区域示意，非实测截图；实际布局会随窗口大小调整。')


class GuideDoc(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(str(filename), pagesize=(PAGE_W, PAGE_H), leftMargin=18*mm,
            rightMargin=18*mm, topMargin=22*mm, bottomMargin=19*mm,
            title='HimaHarness 使用评估手册', author='HimaHarness Polishing',
            subject='v0.2.0-trial.1 使用介绍、分级试用与评估')
        self.heading = '使用评估手册'
        self.chapter_pages = []
        frame = Frame(self.leftMargin, self.bottomMargin, WIDTH,
            PAGE_H-self.topMargin-self.bottomMargin, leftPadding=0, rightPadding=0,
            topPadding=0, bottomPadding=0)
        self.addPageTemplates(PageTemplate(id='guide', frames=[frame], onPage=self.page_header))
    def page_header(self, c, doc):
        c.saveState()
        c.setStrokeColor(PURPLE); c.setLineWidth(1.4)
        c.line(18*mm, PAGE_H-14*mm, PAGE_W-18*mm, PAGE_H-14*mm)
        c.setFont('Helvetica', 8); c.setFillColor(PURPLE)
        c.drawString(18*mm, PAGE_H-10.5*mm, 'HimaHarness / Evaluation Handbook')
        c.setFont('CJK', 7.5); c.setFillColor(MUTED)
        c.drawString(18*mm, 10*mm, '手册 1.0  ·  应用 v0.2.0-trial.1  ·  2026-09-14')
        c.setFont('Helvetica', 8); c.drawRightString(PAGE_W-18*mm, 10*mm, str(doc.page))
        c.restoreState()
    def afterFlowable(self, flowable):
        if getattr(flowable, 'chapter_title', None):
            title = flowable.chapter_title
            key = flowable.chapter_key
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title, key, level=0)
            self.chapter_pages.append((title, self.page))


def pdf_blocks(items):
    out = []
    for kind, value in items:
        if kind == 'p':
            out.append(Paragraph(inline(value, True), styles['body']))
        elif kind == 'h3':
            out.append(Paragraph(inline(value, True), styles['h3']))
        elif kind in ('code', 'callout'):
            style = styles['code'] if kind == 'code' else styles['body']
            rendered = '<br/>'.join(html.escape(line).replace(' ', '&#160;') for line in value.splitlines()) if kind == 'code' else inline(value, True)
            box = Table([[Paragraph(rendered, style)]], colWidths=[WIDTH])
            box.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),LIGHT),
                ('BOX',(0,0),(-1,-1),0.5,BORDER),('LEFTPADDING',(0,0),(-1,-1),12),
                ('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),10),
                ('BOTTOMPADDING',(0,0),(-1,-1),10)]))
            out.extend([box, Spacer(1, 10)])
        elif kind == 'table':
            columns = len(value[0])
            ratios = {2:[0.29,0.71],3:[0.27,0.37,0.36],5:[0.17,0.17,0.24,0.16,0.26]}.get(columns,[1/columns]*columns)
            rows = [[Paragraph(inline(cell, True), styles['th' if index==0 else 'cell']) for cell in row] for index,row in enumerate(value)]
            table = Table(rows, colWidths=[WIDTH*r for r in ratios], repeatRows=1, hAlign='LEFT')
            table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),PURPLE),('VALIGN',(0,0),(-1,-1),'TOP'),
                ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white, colors.HexColor('#F8F9FB')]),
                ('LINEBELOW',(0,0),(-1,0),0.6,PURPLE),('LINEBELOW',(0,1),(-1,-1),0.35,BORDER),
                ('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),
                ('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
            out.extend([table, Spacer(1, 12)])
    return out


source = (HERE / 'evaluation-handbook.md').read_text()
parts = re.split(r'^## (.+)$', source, flags=re.M)
intro = parts[0].split('\n',1)[1]
chapters = [(parts[i],parts[i+1]) for i in range(1,len(parts),2)]
pdf_file = OUT / 'HimaHarness-Evaluation-Handbook-v1.0.pdf'

def make_story(page_map=None):
    story = [Spacer(1, 44), Paragraph('HimaHarness', ParagraphStyle('brand',fontName='Helvetica-Bold',fontSize=33,leading=42,textColor=PURPLE)),
        Paragraph('使用评估手册', ParagraphStyle('cover',fontName='CJK',fontSize=32,leading=44,textColor=INK)),Spacer(1,18)]
    story += pdf_blocks(blocks(intro))
    story += [Spacer(1,14), Paragraph('理解产品  /  独立试用  /  核对证据  /  提出反馈', styles['h3']),
        Paragraph('不要求先懂芯片设计。真实 EDA 研究由专业负责人准备和授权。',styles['body']),PageBreak(),Paragraph('阅读导航',styles['h2'])]
    for index,(title,_) in enumerate(chapters,1):
        page = str(dict(page_map or []).get(title,''))
        label = f'<link href="#chapter-{index}">{html.escape(title)}</link>'
        row=Table([[Paragraph(label,styles['body']),Paragraph(page,styles['small'])]],colWidths=[WIDTH-24,24])
        row.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,-1),.3,BORDER),('LEFTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2)]))
        story.append(row)
    story.append(PageBreak())
    for index,(title,text) in enumerate(chapters,1):
        heading=Paragraph(html.escape(title),styles['h2']);heading.chapter_title=title;heading.chapter_key=f'chapter-{index}'
        story.append(heading)
        if title.startswith('08 '): story.append(InterfaceMap())
        story.extend(pdf_blocks(blocks(text)))
        if index<len(chapters):story.append(PageBreak())
    return story

first=GuideDoc(pdf_file);first.build(make_story())
second=GuideDoc(pdf_file);second.build(make_story(first.chapter_pages))
(HERE / 'pdf-page-map.json').write_text(json.dumps(dict(second.chapter_pages),ensure_ascii=False,indent=2)+'\n')

CSS='''
:root{--ink:#17212d;--muted:#586373;--accent:#6553b9;--line:#dadee6;--soft:#f4f3fa}
*{box-sizing:border-box}body{margin:0;color:var(--ink);background:#f7f8fb;font:16px/1.85 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
nav{position:fixed;inset:0 auto 0 0;width:280px;overflow:auto;padding:26px 22px;background:#202532;color:white}nav a{display:block;color:#e4e2ef;text-decoration:none;font-size:13px;padding:5px 0}nav strong{font-size:19px;color:white}main{max-width:1060px;margin-left:280px;padding:42px 54px 90px;background:white;min-height:100vh}h1{font-size:38px;line-height:1.3}h2{font-size:27px;line-height:1.45;border-top:3px solid var(--accent);padding-top:22px;margin-top:58px}h3{font-size:19px;color:var(--accent)}p{margin:13px 0}a{color:#5544a0}table{width:100%;border-collapse:collapse;margin:20px 0;font-size:14px}th{color:white;background:var(--accent);text-align:left}td,th{padding:11px 12px;border-bottom:1px solid var(--line);vertical-align:top}tr:nth-child(even){background:#f7f8fb}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#57419a;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--soft);padding:18px;border:1px solid var(--line);border-radius:8px;font-size:14px;line-height:1.75}pre code{color:var(--ink)}blockquote{margin:22px 0;padding:13px 20px;background:var(--soft);border-left:4px solid var(--accent)}.map{display:grid;grid-template-columns:1fr 1.8fr 1.6fr;gap:10px}.map>div{background:var(--soft);border:1px solid var(--line);padding:15px;border-radius:8px}.caption{font-size:12px;color:var(--muted)}.version{color:var(--muted);font-size:14px}.links{padding:16px;background:var(--soft)}
@media(max-width:980px){nav{position:static;width:auto;max-height:290px}main{margin:0;padding:24px}h1{font-size:30px}.map{grid-template-columns:1fr}}
@media print{body{background:white;font-size:10pt}nav{display:none}main{margin:0;padding:0;max-width:none}section{break-before:page}h2{margin-top:0;font-size:20pt}h3{break-after:avoid}table{font-size:9pt}tr,pre,blockquote{break-inside:avoid}a{color:inherit;text-decoration:none}.links{display:none}@page{size:A4;margin:19mm}}
'''

def html_blocks(items):
    out=[]
    for kind,value in items:
        if kind=='table':
            rows=[]
            for index,row in enumerate(value):
                tag='th' if index==0 else 'td';rows.append('<tr>'+''.join(f'<{tag}>{inline(cell)}</{tag}>' for cell in row)+'</tr>')
            out.append('<table><thead>'+rows[0]+'</thead><tbody>'+''.join(rows[1:])+'</tbody></table>')
        elif kind=='code':out.append('<pre><code>'+html.escape(value)+'</code></pre>')
        elif kind=='callout':out.append('<blockquote>'+inline(value)+'</blockquote>')
        else:
            tag='h3' if kind=='h3' else 'p';out.append(f'<{tag}>{inline(value)}</{tag}>')
    return ''.join(out)

def document_html(title, text):
    sections=re.split(r'^## (.+)$',text,flags=re.M)
    introduction=sections[0].split('\n',1)[1]
    body=html_blocks(blocks(introduction));nav=[]
    for i in range(1,len(sections),2):
        heading=sections[i];key=f'chapter-{(i+1)//2}';nav.append(f'<a href="#{key}">{html.escape(heading)}</a>')
        body+=f'<section id="{key}"><h2>{html.escape(heading)}</h2>'
        if heading.startswith('08 '):
            body+='<div class="map"><div>① 工作区与会话</div><div>② 对话、代码与行动</div><div>③ Live Run<br>④ 结果与报告<br>⑤ 文件与资产</div></div><p class="caption">界面区域示意，非实测截图。</p>'
        body+=html_blocks(blocks(sections[i+1]))+'</section>'
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html.escape(title)+'</title><style>'+CSS+'</style></head><body><nav><strong>HimaHarness</strong><p>使用评估资料包</p>'+''.join(nav)+'</nav><main><h1>'+html.escape(title)+'</h1><div class="links"><a href="evaluation-handbook.html">使用手册</a> · <a href="evaluation-worksheet.html">评估记录表</a> · <a href="admin-handover.html">管理员交接</a> · <a href="evaluation-scores.csv">评分 CSV</a></div>'+body+'</main></body></html>'

for name,title in [('evaluation-handbook','使用评估手册'),('evaluation-worksheet','试用评估记录表'),('admin-handover','管理员交接参考')]:
    (HERE/(name+'.html')).write_text(document_html('HimaHarness '+title,(HERE/(name+'.md')).read_text()),encoding='utf-8')
with (HERE/'evaluation-scores.csv').open('w',encoding='utf-8-sig',newline='') as f:
    writer=csv.writer(f);writer.writerow(['评估者','日期','应用版本','环境代号','维度','评分（0-4或N/A）','具体观察与证据','人工帮助次数','问题影响','未验证范围'])
    for dimension in ['理解成本','上手与配置','编码闭环','状态与介入','证据与诚实','知识可用性','研究贡献','日常使用价值']:
        writer.writerow(['','','v0.2.0-trial.1','',dimension,'','','','',''])
print(f'Built {pdf_file}; {len(chapters)} chapters; {second.page} PDF pages; HTML and CSV generated.')
