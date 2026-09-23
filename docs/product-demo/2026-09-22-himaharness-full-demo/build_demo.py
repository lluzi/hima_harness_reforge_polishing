#!/usr/bin/env python3
"""Build the evidence-backed HimaHarness Chinese demo video and screenshot kit."""

from __future__ import annotations

import hashlib
import json
import math
import shutil
import subprocess
import textwrap
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
FRAMES = OUT / "frames"
KEY = OUT / "screenshots"
BUILD = OUT / ".build"

W, H = 1920, 1080
BG = "#F4F6FA"
INK = "#15171A"
MUTED = "#667085"
BLUE = "#3B6FF5"
ORANGE = "#D15F3A"
GREEN = "#278A55"
RED = "#C94F4F"
CARD = "#FFFFFF"
FONT = "/System/Library/Fonts/STHeiti Medium.ttc"


@dataclass(frozen=True)
class Scene:
    slug: str
    title: str
    narration: str
    visual: str
    source: str | None = None


SCENES = [
    Scene("01-title", "HimaHarness 全景演示", "HimaHarness 把工程师、AI、方法包、商业 EDA 和可审计证据组织在一个持续运行的工程工作区中。", "title"),
    Scene("02-start", "从启动到统一工作区", "应用启动后，对话始终位于左侧。右侧工作区承载配置、运行图、代码、证据和报告，工程师不需要在多个独立工具之间来回切换。", "screenshot", "docs/assessment/2026-09-11/unified-ui/light-start.png"),
    Scene("03-dialogue", "用中文理解任务，而不是填写内部表格", "工程师可以直接用中文提出目标。HimaGuide 负责解释 Pack、检查输入和预算，并把自然语言目标转成一份可审阅的 Campaign 提案。", "dialogue"),
    Scene("04-config", "Pack、Site、输入与预算一次对齐", "创建 Campaign 之前，系统先核对固定版本的 Pack、可用 Site、声明输入、工具能力和写入边界。缺失条件会在昂贵任务开始前暴露。", "screenshot", "docs/assessment/2026-09-16/campaign-workspace/config-ready-light.png"),
    Scene("05-agent", "一个可见的 Campaign Agent 持续负责", "每个 Campaign 只有一个持久的执行 Agent。它读取参考方法和当前事实，决定下一步动作；聊天结束、应用重开或上下文压缩都不会偷偷创建第二条 Run。", "screenshot", "docs/assessment/2026-09-16/campaign-workspace/graph-51-node-light.png"),
    Scene("06-node", "Fabric 把复杂流程拆成可检查节点", "节点明确声明输入、工具、证据、预算和完成条件。点开节点即可看到事实、作业、代码、知识与证据，也能在安全边界暂停或继续。", "screenshot", "docs/assessment/2026-09-16/campaign-workspace/running-node-card-light.png"),
    Scene("07-pause", "暂停不丢事实，继续不重跑历史", "暂停只阻止新工作。已经提交的 EDA Job 可以落下事实，之后从同一 Run、同一节点和同一证据链恢复。", "screenshot", "docs/assessment/2026-09-12/pls-19/desktop/owned-paused.png"),
    Scene("08-code", "对话、代码和设计文件同屏", "工程师可以在同一个工作区查看生成脚本、输入身份和中间文件。AI 的修改不是黑箱，它必须留下可审阅、可回滚的字节与来源。", "screenshot", "docs/assessment/2026-09-11/unified-ui/light-code.png"),
    Scene("09-workshop", "Workshop 允许现场研究与策略更新", "Pack 提供方法骨架，Workshop 允许 Agent 在声明范围内生成研究代码、比较新策略并回写下一轮方案。确定性 Framework 继续负责身份、预算和事实校验。", "screenshot", "docs/assessment/2026-09-12/pls-20/images/light-workshop.png"),
    Scene("10-report", "报告区分事实、推断和未知", "每一次成功、失败和未完成范围都进入技术报告。Harness 不把代理指标当成商业收益，也不会把预算耗尽改写成目标达成。", "screenshot", "docs/assessment/2026-09-11/unified-ui/light-report.png"),
    Scene("11-side-talk", "Side Talk 不夺走运行所有权", "工程师可以另开 Side Talk 追问、查代码或讨论方案，而不改变正在运行的 Campaign Agent。只有显式交接才会改变执行所有权。", "screenshot", "docs/assessment/2026-09-16/campaign-workspace/side-talk-light.png"),
    Scene("12-platform", "平台闭环：方法、执行、证据、反馈", "HimaHarness 的价值不是替代某一颗 EDA 工具，而是把长周期、多工具、可恢复的研究闭环变成一个可重复交付的工程系统。", "platform"),
    Scene("13-dtco", "Pack 一：Custom Cell Fmax DTCO 5.2.10", "这个 Pack 面向设计驱动的定制标准单元研究。它从网表与物理信息中寻找 Cell Demand，以累计 Library 为资产，并把真实 matched post-route Fmax 作为最终 E0 观察。", "dtco"),
    Scene("14-dtco-factors", "免费因子负责观察，商业 EDA 负责裁决", "F0 检查功能与接口可行性；F1、F2、F3 并列记录局部结构、全设计映射和代理时序。它们在完成校准前无权否决候选，E0 才给出真实设计响应。", "dtco-factors"),
    Scene("15-dtco-result", "自进化并不等于粉饰结果", "最新完整试验跨越七代和五次算法修订，把 Cell Demand 覆盖从三十八比四十二推进到三十八比三十八；但 matched Fmax 仍为负二点九三个百分点，因此 Run 诚实地以预算边界结束。", "dtco-chart"),
    Scene("16-xtop", "Pack 二：XTop Timing Closure 1.0.5", "这个 Pack 以只读 Innovus database 为输入，串联 XTop、Innovus、StarRC 和 PrimeTime，持续推进 setup 与 hold，输出最佳已验证 database，而不是最后一次尝试。", "xtop"),
    Scene("17-fabric", "每一种商业工具都有独立 Fabric 节点", "Innovus 负责数据库导出和增量 ECO，StarRC 刷新寄生参数，PrimeTime 提供四场景真实时序，XTop 生成逻辑与物理 Tcl。任何工具都不能替另一工具伪造完成状态。", "xtop-flow"),
    Scene("18-feedback", "优化对象是 Endpoint 集合，不是一条路径", "每代都比较 fixed、remaining、entrant 和 regressed endpoint。下一轮计划必须回答上一轮解决了什么、引入了什么，以及为什么仍值得继续。", "endpoint"),
    Scene("19-xtop-result", "真实 Trial 30：连续保留更优 Database", "当前证据显示 closure score 从二百四十三点五八下降到一百七十五点六二，连续八代都保留了新的 best database。趋势仍在改善，因此系统没有提前宣称 timing clean。", "xtop-chart"),
    Scene("20-route", "保留布线的原位 ECO", "XTop 输出两份可 source 的 Innovus macro Tcl，并启用 keep route。Innovus 先应用逻辑脚本，再应用物理脚本，随后 eco route 和完整刷新，最大限度保留未触碰布线。", "route"),
    Scene("21-assets", "经验沉淀为可复用资产", "运行完成后，策略、代码、输入哈希、证据、报告和失败原因都归档到 Pack 的知识资产中。下一次研究可以引用历史，但当前结论仍由当前设计重新验证。", "screenshot", "docs/validation/growth-assets/ui-assets/revision-history-archive.png"),
    Scene("22-end", "HimaHarness：把复杂芯片优化变成持续、可信的工程能力", "一个工程师可以定义方向，AI 可以持续研究，Fabric 保证边界，商业 EDA 给出事实，而每一次尝试都会留下可复核、可恢复、可继续的经验。", "end"),
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    # The system Heiti TTC exposes a stable CJK face at index zero. Stroke is used for emphasis.
    return ImageFont.truetype(FONT, size=size, index=0)


def rounded(draw: ImageDraw.ImageDraw, box, radius=24, fill=CARD, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def fit_text(draw: ImageDraw.ImageDraw, text: str, max_width: int, size: int, max_lines: int = 3):
    f = font(size)
    lines, current = [], ""
    for ch in text:
        trial = current + ch
        if draw.textbbox((0, 0), trial, font=f)[2] <= max_width:
            current = trial
        else:
            lines.append(current)
            current = ch
    if current:
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1][:-1] + "…"
    return "\n".join(lines), f


def base_frame(title: str, section: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, 92), fill="#101828")
    d.text((54, 22), "HimaHarness", font=font(34), fill="white", stroke_width=1)
    d.text((330, 29), section, font=font(24), fill="#B8C4E8")
    d.text((54, 116), title, font=font(44), fill=INK, stroke_width=1)
    return im, d


def paste_screenshot(im: Image.Image, source: Path, y=184, h=720):
    src = Image.open(source).convert("RGB")
    ratio = min(1780 / src.width, h / src.height)
    size = (int(src.width * ratio), int(src.height * ratio))
    src = src.resize(size, Image.Resampling.LANCZOS)
    shadow = Image.new("RGBA", (size[0] + 40, size[1] + 40), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((20, 20, size[0] + 20, size[1] + 20), 18, fill=(12, 25, 58, 55))
    shadow = shadow.filter(ImageFilter.GaussianBlur(12))
    x = (W - size[0]) // 2
    im.paste(shadow, (x - 20, y - 20), shadow)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *size), 14, fill=255)
    im.paste(src, (x, y), mask)


def caption(im: Image.Image, text: str):
    d = ImageDraw.Draw(im)
    rounded(d, (54, 934, W - 54, 1050), 28, fill="#101828")
    wrapped, f = fit_text(d, text, W - 180, 30, 2)
    bbox = d.multiline_textbbox((0, 0), wrapped, font=f, spacing=10, align="center")
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.multiline_text(((W - tw) / 2, 992 - th / 2), wrapped, font=f, fill="white", spacing=10, align="center")


def card_title(im, d, text, subtitle=None, accent=BLUE):
    rounded(d, (180, 240, W - 180, 850), 42, fill=CARD, outline="#D0D5DD", width=2)
    d.rounded_rectangle((180, 240, 206, 850), radius=13, fill=accent)
    wrapped, f = fit_text(d, text, 1360, 66, 3)
    d.multiline_text((260, 350), wrapped, font=f, fill=INK, spacing=18, stroke_width=1)
    if subtitle:
        w2, f2 = fit_text(d, subtitle, 1320, 34, 4)
        d.multiline_text((260, 585), w2, font=f2, fill=MUTED, spacing=14)


def arrow(d, a, b, fill="#98A2B3", width=5):
    d.line((a, b), fill=fill, width=width)
    ang = math.atan2(b[1] - a[1], b[0] - a[0])
    for delta in (2.6, -2.6):
        p = (b[0] + 16 * math.cos(ang + delta), b[1] + 16 * math.sin(ang + delta))
        d.line((b, p), fill=fill, width=width)


def box(d, xy, title, sub="", color=BLUE):
    rounded(d, xy, 24, fill="white", outline="#CBD5E1", width=2)
    x1, y1, x2, y2 = xy
    d.rounded_rectangle((x1, y1, x1 + 14, y2), 7, fill=color)
    d.text((x1 + 30, y1 + 22), title, font=font(28), fill=INK, stroke_width=1)
    if sub:
        w, f = fit_text(d, sub, x2 - x1 - 60, 20, 3)
        d.multiline_text((x1 + 30, y1 + 67), w, font=f, fill=MUTED, spacing=8)


def render_generated(scene: Scene) -> Image.Image:
    section = "产品全景"
    if "dtco" in scene.slug: section = "Pack 01 · Custom Cell Fmax DTCO"
    if "xtop" in scene.slug or scene.slug in {"17-fabric", "18-feedback", "20-route"}: section = "Pack 02 · XTop Timing Closure"
    im, d = base_frame(scene.title, section)

    if scene.visual == "title":
        card_title(im, d, "让一个工程师组织跨工具、跨迭代的芯片优化研究", "对话常驻 · Pack 方法 · Fabric 执行 · 商业 EDA 事实 · 可恢复证据", BLUE)
    elif scene.visual == "end":
        card_title(im, d, "从一次任务，沉淀为持续改进的工程能力", "方法可以发布，Run 可以恢复，经验可以复用，结论可以审计。", GREEN)
    elif scene.visual == "dialogue":
        src = ROOT / "docs/assessment/2026-09-11/ui-benchmark/after-chat-light.png"
        paste_screenshot(im, src, y=180, h=735)
        # Cover the center with a clean, explicitly scripted Chinese conversation.
        rounded(d, (390, 255, 1530, 840), 30, fill=(255, 255, 255), outline="#D0D5DD", width=2)
        d.text((445, 285), "中文演示对话", font=font(30), fill=INK, stroke_width=1)
        d.text((1260, 293), "基于已验证能力", font=font(20), fill=BLUE)
        rounded(d, (700, 350, 1460, 465), 24, fill="#E8F0FF")
        q, fq = fit_text(d, "我想把 AES 的 post-route Fmax 提升 5%。你会怎么组织这个任务？", 680, 27, 3)
        d.multiline_text((735, 378), q, font=fq, fill=INK, spacing=9)
        rounded(d, (445, 500, 1325, 735), 24, fill="#F2F4F7")
        a = "我会先核对 Pack、Site、输入和预算，再创建唯一的持久研究任务。免费代理记录 F0–F3 指标，商业 EDA 的 E0 给出真实响应；每次失配都会回到剩余 endpoint frontier 继续研究。"
        aa, fa = fit_text(d, a, 800, 26, 6)
        d.multiline_text((480, 530), aa, font=fa, fill=INK, spacing=10)
    elif scene.visual == "platform":
        boxes = [
            ((80, 280, 390, 470), "工程师 + HimaGuide", "中文目标、追问、干预、签收", BLUE),
            ((500, 280, 810, 470), "HimaPack", "方法、知识、图、规则、读取器", ORANGE),
            ((920, 280, 1230, 470), "HimaFabric", "节点、预算、权限、作业、Ledger", "#7A5AF8"),
            ((1340, 280, 1840, 470), "Site + EDA", "真实工具、许可证、数据库与报告", GREEN),
            ((500, 610, 1230, 800), "Evidence + Experience", "输入身份、代码、成功、失败、报告与下一轮反馈", "#0E7490"),
        ]
        for xy, t, s, c in boxes: box(d, xy, t, s, c)
        arrow(d, (390, 375), (500, 375)); arrow(d, (810, 375), (920, 375)); arrow(d, (1230, 375), (1340, 375))
        arrow(d, (1580, 470), (1200, 610)); arrow(d, (920, 705), (650, 470)); arrow(d, (500, 705), (300, 470))
    elif scene.visual == "dtco":
        card_title(im, d, "Design Information Graph → Cell Demand → Cumulative Library → Matched E0", "单输出与多输出、D1/D2/D4/D6/D8 drive family、局部免费代理、商业 P&R、跨代反馈", ORANGE)
    elif scene.visual == "dtco-factors":
        for i, (name, sub, c) in enumerate([
            ("F0", "功能、接口、真值表", "#64748B"), ("F1", "局部逻辑结构", BLUE),
            ("F2", "全设计映射", "#7A5AF8"), ("F3", "代理时序指标", "#0E7490")]):
            x = 100 + i * 430
            box(d, (x, 290, x + 350, 500), name, sub, c)
        box(d, (570, 635, 1350, 825), "E0 · Commercial Observation", "同一设计、同一条件下的 matched DC / Innovus QoR；不训练跨设计收益预测", ORANGE)
        for i in range(4): arrow(d, (275 + i * 430, 500), (760 + i * 120, 635), fill="#98A2B3", width=4)
    elif scene.visual == "dtco-chart":
        # Two evidence cards: demand closure improved; commercial objective remained negative.
        rounded(d, (110, 250, 900, 835), 32, fill="white", outline="#D0D5DD", width=2)
        d.text((160, 290), "研究机制确实在学习", font=font(34), fill=INK, stroke_width=1)
        d.text((160, 355), "Cell Demand coverage", font=font(24), fill=MUTED)
        for y, label, val, col in [(450, "Generation 1", 38/42, BLUE), (610, "Generation 7", 1.0, GREEN)]:
            d.text((160, y), label, font=font(25), fill=INK)
            rounded(d, (385, y + 4, 820, y + 42), 18, fill="#E5E7EB")
            d.rounded_rectangle((385, y + 4, 385 + int(435 * val), y + 42), 18, fill=col)
            d.text((385, y + 60), "38 / 42" if val < 1 else "38 / 38", font=font(23), fill=col)
        rounded(d, (1020, 250, 1810, 835), 32, fill="white", outline="#D0D5DD", width=2)
        d.text((1070, 290), "商业结果仍诚实为负", font=font(34), fill=INK, stroke_width=1)
        d.text((1070, 355), "Matched post-route Fmax", font=font(24), fill=MUTED)
        vals = [("Gen 1", -3.92), ("Gen 7", -2.93), ("Goal", 5.0)]
        for i, (lab, val) in enumerate(vals):
            x = 1110 + i * 210
            zero = 690
            scale = 35
            d.line((x + 55, 430, x + 55, 730), fill="#D0D5DD", width=2)
            if val >= 0:
                y1, y2, col = zero - val * scale, zero, GREEN
            else:
                y1, y2, col = zero, zero - val * scale, RED
            d.rectangle((x, y1, x + 110, y2), fill=col)
            d.text((x + 18, 750), lab, font=font(22), fill=INK)
            d.text((x + 10, min(y1, y2) - 38), f"{val:+.2f}%", font=font(22), fill=col)
    elif scene.visual == "xtop":
        card_title(im, d, "Innovus DB → XTop / Innovus / StarRC / PrimeTime → Best Innovus DB", "以 refreshed PrimeTime 结果为准；保留每代 ECO、寄生参数、endpoint 变化和候选数据库", GREEN)
    elif scene.visual == "xtop-flow":
        items = [
            ("Innovus export", "数据库与网表"), ("StarRC", "寄生参数"), ("PrimeTime", "四场景时序"),
            ("Endpoint delta", "fixed / entrant / regressed"), ("AI plan", "有界 fix 计划"),
            ("XTop", "逻辑 + 物理 Tcl"), ("Innovus ECO", "source + ecoRoute"), ("Best DB", "独立刷新后保留")]
        positions = [(80,270),(500,270),(920,270),(1340,270),(1340,620),(920,620),(500,620),(80,620)]
        for (t,s),(x,y) in zip(items,positions): box(d,(x,y,x+330,y+150),t,s,GREEN if t in {"StarRC","PrimeTime","XTop","Innovus ECO"} else BLUE)
        pts=[(410,345,500,345),(830,345,920,345),(1250,345,1340,345),(1505,420,1505,620),(1340,695,1250,695),(920,695,830,695),(500,695,410,695)]
        for x1,y1,x2,y2 in pts: arrow(d,(x1,y1),(x2,y2))
        arrow(d,(245,620),(245,420),fill=ORANGE)
    elif scene.visual == "endpoint":
        labels=[("FIXED","上一代违例已消失",GREEN),("REMAINING","仍需处理",BLUE),("ENTRANT","新进入前沿",ORANGE),("REGRESSED","被动作拖慢",RED)]
        for i,(t,s,c) in enumerate(labels):
            x=90+i*455; box(d,(x,300,x+370,520),t,s,c)
        rounded(d,(260,650,1660,820),28,fill="#101828")
        d.text((330,690),"下一代策略 = 当前 Endpoint 集合 + 实测变化 + 剩余预算",font=font(38),fill="white",stroke_width=1)
    elif scene.visual == "xtop-chart":
        vals=[243.58,217.96,209.49,200.82,192.27,188.12,183.96,179.80,175.62]
        left,top,right,bottom=170,255,1760,825
        rounded(d,(90,205,1830,870),32,fill="white",outline="#D0D5DD",width=2)
        mn,mx=min(vals)-5,max(vals)+5
        pts=[]
        for i,v in enumerate(vals):
            x=left+i*(right-left)/(len(vals)-1); y=bottom-(v-mn)/(mx-mn)*(bottom-top); pts.append((x,y))
        for yv in [180,200,220,240]:
            y=bottom-(yv-mn)/(mx-mn)*(bottom-top); d.line((left,y,right,y),fill="#E5E7EB",width=2); d.text((105,y-14),str(yv),font=font(20),fill=MUTED)
        d.line(pts,fill=GREEN,width=8)
        for i,(x,y) in enumerate(pts):
            d.ellipse((x-10,y-10,x+10,y+10),fill="white",outline=GREEN,width=5)
            d.text((x-22,bottom+25),"B" if i==0 else str(i),font=font(20),fill=INK)
        d.text((left,220),"Closure score ↓ 27.9%",font=font(32),fill=GREEN,stroke_width=1)
        d.text((1280,220),"8 代连续 retained",font=font(28),fill=BLUE)
    elif scene.visual == "route":
        box(d,(100,300,540,560),"XTop", "write_design_changes\n-format INNOVUS -keep_route",GREEN)
        box(d,(740,235,1180,450),"Logical Tcl", "ecoAddRepeater / 逻辑变更",BLUE)
        box(d,(740,535,1180,750),"Physical Tcl", "placeInstance / 物理位置",ORANGE)
        box(d,(1380,300,1820,560),"Innovus", "source logical → source physical\n→ ecoRoute → verify",GREEN)
        arrow(d,(540,430),(740,340)); arrow(d,(540,430),(740,640)); arrow(d,(1180,340),(1380,410)); arrow(d,(1180,640),(1380,450))
        rounded(d,(430,800,1490,875),22,fill="#EAF7EF"); d.text((490,816),"无 loadECO · 不主动删除 touched-net route",font=font(30),fill=GREEN,stroke_width=1)
    else:
        card_title(im, d, scene.title, scene.narration)

    caption(im, scene.narration)
    return im


def render_scene(scene: Scene) -> Image.Image:
    if scene.visual == "screenshot":
        im, _ = base_frame(scene.title, "HimaHarness 产品界面")
        assert scene.source
        paste_screenshot(im, ROOT / scene.source)
        caption(im, scene.narration)
        return im
    return render_generated(scene)


def srt_time(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def duration(path: Path) -> float:
    return float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path)
    ], text=True).strip())


def copy_key_screenshots() -> dict[str, str]:
    selected = {
        "01-startup.png": "docs/assessment/2026-09-11/unified-ui/light-start.png",
        "02-configuration-ready.png": "docs/assessment/2026-09-16/campaign-workspace/config-ready-light.png",
        "03-dtco-full-graph.png": "docs/assessment/2026-09-16/campaign-workspace/graph-51-node-light.png",
        "04-node-detail.png": "docs/assessment/2026-09-16/campaign-workspace/running-node-card-light.png",
        "05-pause-control.png": "docs/assessment/2026-09-12/pls-19/desktop/owned-paused.png",
        "06-workshop.png": "docs/assessment/2026-09-12/pls-20/images/light-workshop.png",
        "07-files-and-code.png": "docs/assessment/2026-09-11/unified-ui/light-code.png",
        "08-technical-report.png": "docs/assessment/2026-09-11/unified-ui/light-report.png",
        "09-side-talk.png": "docs/assessment/2026-09-16/campaign-workspace/side-talk-light.png",
        "10-knowledge-archive.png": "docs/validation/growth-assets/ui-assets/revision-history-archive.png",
    }
    KEY.mkdir(parents=True, exist_ok=True)
    for dst, src in selected.items(): shutil.copy2(ROOT / src, KEY / dst)
    return selected


def main() -> None:
    for p in (FRAMES, KEY, BUILD): p.mkdir(parents=True, exist_ok=True)
    sources = copy_key_screenshots()
    clips = []
    timings = []
    cursor = 0.0
    for idx, scene in enumerate(SCENES, 1):
        frame = FRAMES / f"{idx:02d}-{scene.slug}.png"
        render_scene(scene).save(frame, optimize=True)
        audio = BUILD / f"{idx:02d}.aiff"
        if not audio.exists() or audio.stat().st_size < 1000:
            run(["say", "-v", "Tingting", "-r", "185", "-o", str(audio), scene.narration])
        dur = max(5.5, duration(audio) + 1.0)
        clip = BUILD / f"{idx:02d}.mp4"
        fade_out = max(0.0, dur - 0.4)
        valid_clip = False
        if clip.exists() and clip.stat().st_size > 1000:
            try:
                valid_clip = duration(clip) > 1.0
            except Exception:
                valid_clip = False
        if not valid_clip:
            run([
                "ffmpeg", "-loglevel", "error", "-y", "-loop", "1", "-framerate", "30", "-i", str(frame), "-i", str(audio),
                "-t", f"{dur:.3f}", "-vf", f"fade=t=in:st=0:d=0.35,fade=t=out:st={fade_out:.3f}:d=0.35,format=yuv420p",
                "-af", "apad", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "25", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", str(clip)
            ])
        clips.append(clip)
        timings.append((cursor, cursor + dur, scene.narration, scene.title))
        cursor += dur

    concat = BUILD / "concat.txt"
    concat.write_text("".join(f"file '{c.as_posix()}'\n" for c in clips), encoding="utf-8")
    final = OUT / "HimaHarness-full-demo.zh-CN.mp4"
    run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", "-movflags", "+faststart", str(final)])

    srt = []
    for i, (start, end, text, _title) in enumerate(timings, 1):
        srt.extend([str(i), f"{srt_time(start)} --> {srt_time(end)}", text, ""])
    (OUT / "HimaHarness-full-demo.zh-CN.srt").write_text("\n".join(srt), encoding="utf-8")

    manifest = {
        "schema": "hima.demo-kit/1",
        "app": "HimaHarness 0.3.0-trial.16",
        "video": final.name,
        "duration_seconds": round(cursor, 3),
        "resolution": f"{W}x{H}",
        "voice": "macOS Tingting zh_CN, rate 185",
        "pack_identities": {
            "dtco": "custom-cell-fmax-dtco@5.2.10 / e60bbfb6e3466872ff24e590adb31aab62f4232b5eb9c9db71db9c75dddb629c",
            "timing": "xtop-timing-closure@1.0.5 / ea774e6fa31f5c9949cf6936a66ad8881d2500d8558e7550e3d920ce129db092",
        },
        "source_screenshots": sources,
        "scenes": [{"index": i + 1, **s.__dict__} for i, s in enumerate(SCENES)],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    checks = []
    optional = [
        OUT / "HimaHarness-human-screen-demo.zh-CN.mp4",
        OUT / "HimaHarness-human-screen-demo.zh-CN.srt",
        OUT / "screen-demo-manifest.json",
    ]
    for p in sorted([
        final,
        OUT / "HimaHarness-full-demo.zh-CN.srt",
        *KEY.glob("*.png"),
        *FRAMES.glob("*.png"),
        *(p for p in optional if p.exists()),
        *(OUT / "screen-recording").glob("*.png"),
    ]):
        checks.append(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(OUT)}")
    (OUT / "SHA256SUMS.txt").write_text("\n".join(checks) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
