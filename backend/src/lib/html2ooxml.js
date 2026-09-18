/*
 * html2ooxml - converts the HTML produced by the pwndoc editor (TipTap 2) into
 * a sequence of Open Office XML blocks (<w:p> / <w:tbl>) that docxtemplater
 * injects through a raw tag: {@text | convertHTML}.
 *
 * The converter emits the XML directly (no intermediate library) so that we
 * control exactly which run/paragraph properties end up in the document.
 *
 * html2ooxml(html, style, listIds, options)
 *   html     : HTML string from the editor
 *   style    : name of a formatting profile (see report-styles.js) or, for
 *              backward compatibility, the id of a Word paragraph style
 *   listIds  : optional array of numId values used for ordered lists
 *   options  : { styles } - resolved formatting configuration
 *              (report-styles.resolve()). Without it the converter relies on
 *              the template styles only (Code, CodeChar, ListParagraph,
 *              PwndocLink...) - this is the historical behaviour.
 */

const htmlparser = require("htmlparser2");

const BULLET_NUM_ID = 1;    // numbering.xml definition used for <ul>
const NUMBERED_NUM_ID = 2;  // default numbering.xml definition used for <ol>
const MAX_LIST_LEVEL = 8;
const TABLE_WIDTH_DXA = 9638; // usable width of an A4 page with 2.54cm margins

// The 4 highlight colors offered by the editor map to Word highlight names.
const HIGHLIGHT_MAP = {
  "#ffff00": "yellow",
  "#fe0000": "red",
  "#ff0000": "red",
  "#00ff00": "green",
  "#00ffff": "cyan",
};

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeAttr(text) {
  return escapeXml(text);
}

function hexColor(value) {
  if (!value) return null;
  const v = String(value).trim().replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(v) ? v : null;
}

// Points to half-points
function halfPoints(size) {
  const n = Number(size);
  if (!n || n <= 0) return null;
  return Math.round(n * 2);
}

/*
 * Run properties are kept as a plain object and serialized in schema order.
 * Keys: rStyle, font, bold, italic, strike, color, size, highlight,
 *       underline, shading
 */
function runPropsXml(p) {
  if (!p) return "";
  let xml = "";
  if (p.rStyle) xml += `<w:rStyle w:val="${escapeAttr(p.rStyle)}"/>`;
  if (p.font) {
    const f = escapeAttr(p.font);
    xml += `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/>`;
  }
  if (p.bold) xml += `<w:b/><w:bCs/>`;
  if (p.bold === false && p.explicitBold) xml += `<w:b w:val="0"/><w:bCs w:val="0"/>`;
  if (p.italic) xml += `<w:i/><w:iCs/>`;
  if (p.strike) xml += `<w:strike/>`;
  if (p.color) xml += `<w:color w:val="${p.color}"/>`;
  if (p.size) xml += `<w:sz w:val="${p.size}"/><w:szCs w:val="${p.size}"/>`;
  if (p.highlight) xml += `<w:highlight w:val="${p.highlight}"/>`;
  if (p.underline) xml += `<w:u w:val="single"/>`;
  if (p.shading) xml += `<w:shd w:val="clear" w:color="auto" w:fill="${p.shading}"/>`;
  return xml ? `<w:rPr>${xml}</w:rPr>` : "";
}

/*
 * Paragraph properties.
 * Keys: pStyle, numbering {numId, level}, shading, spacingBefore,
 *       spacingAfter, lineSpacing, indentLeft, alignment, borderBottom,
 *       markRunProps (run properties of the paragraph mark)
 */
function paraPropsXml(p) {
  if (!p) return "";
  let xml = "";
  if (p.pStyle) xml += `<w:pStyle w:val="${escapeAttr(p.pStyle)}"/>`;
  if (p.keepNext) xml += `<w:keepNext/>`;
  if (p.numbering) {
    xml += `<w:numPr><w:ilvl w:val="${p.numbering.level}"/><w:numId w:val="${p.numbering.numId}"/></w:numPr>`;
  }
  if (p.borderBottom) {
    xml += `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>`;
  }
  if (p.shading) xml += `<w:shd w:val="clear" w:color="auto" w:fill="${p.shading}"/>`;
  if (p.spacingBefore !== undefined || p.spacingAfter !== undefined || p.lineSpacing !== undefined) {
    let attrs = "";
    if (p.spacingBefore !== undefined) attrs += ` w:before="${Math.round(p.spacingBefore * 20)}"`;
    if (p.spacingAfter !== undefined) attrs += ` w:after="${Math.round(p.spacingAfter * 20)}"`;
    if (p.lineSpacing !== undefined) attrs += ` w:line="${Math.round(p.lineSpacing * 240)}" w:lineRule="auto"`;
    xml += `<w:spacing${attrs}/>`;
  }
  if (p.indentLeft) xml += `<w:ind w:left="${p.indentLeft}"/>`;
  if (p.alignment) xml += `<w:jc w:val="${p.alignment}"/>`;
  if (p.markRunProps) xml += runPropsXml(p.markRunProps);
  return xml ? `<w:pPr>${xml}</w:pPr>` : "";
}

const ALIGNMENTS = { left: "left", start: "left", center: "center", right: "right", justify: "both", both: "both" };

/*
 * Converts a formatting profile from the configuration into paragraph and
 * run properties. A profile may contain: font, size (pt), color, bold, italic,
 * alignment, shading, spacingBefore, spacingAfter (pt), lineSpacing (multiple),
 * pStyle.
 */
function profileToProps(profile) {
  const result = { para: {}, run: {} };
  if (!profile) return result;
  if (profile.pStyle) result.para.pStyle = profile.pStyle;
  if (profile.alignment && ALIGNMENTS[profile.alignment]) result.para.alignment = ALIGNMENTS[profile.alignment];
  if (hexColor(profile.shading)) result.para.shading = hexColor(profile.shading);
  if (profile.spacingBefore !== undefined && profile.spacingBefore !== null && profile.spacingBefore !== "") result.para.spacingBefore = Number(profile.spacingBefore);
  if (profile.spacingAfter !== undefined && profile.spacingAfter !== null && profile.spacingAfter !== "") result.para.spacingAfter = Number(profile.spacingAfter);
  if (profile.lineSpacing) result.para.lineSpacing = Number(profile.lineSpacing);
  if (profile.font) result.run.font = profile.font;
  if (halfPoints(profile.size)) result.run.size = halfPoints(profile.size);
  if (hexColor(profile.color)) result.run.color = hexColor(profile.color);
  if (profile.bold) result.run.bold = true;
  if (profile.italic) result.run.italic = true;
  return result;
}

function html2ooxml(html, style = "", listIds = [], options = {}) {
  if (html === "" || html === null || html === undefined) return "";
  html = String(html);
  if (!html.match(/^<.+>/)) html = `<p>${html}</p>`;

  const styles = (options && options.styles) || {};
  const profiles = styles.profiles || {};
  const inlineCodeCfg = styles.inlineCode || {};
  const codeBlockCfg = styles.codeBlock || {};
  const linkCfg = styles.link || {};
  const highlightSyntax = !!styles.highlightSyntax;
  const syntaxColors = styles.syntaxColors || {};

  // Style ids defined by the template (Set); when known, built-in references
  // to template styles (Code, CodeChar, PwndocLink, ListParagraph, HeadingN)
  // are only emitted if the template actually defines them: some consumers
  // (LibreOffice) drop the direct formatting of a paragraph whose style is
  // unknown. Styles explicitly configured are always emitted.
  const knownStyles = styles.templateStyleIds instanceof Set ? styles.templateStyleIds
    : Array.isArray(styles.templateStyleIds) ? new Set(styles.templateStyleIds) : null;
  function templateStyle(id) {
    if (!knownStyles) return id;
    return knownStyles.has(id) ? id : null;
  }

  // Profile selection: `style` is a profile name, otherwise a Word style id.
  let profileName = "text";
  let legacyPStyle = null;
  if (style && typeof style === "string") {
    if (profiles[style]) profileName = style;
    else legacyPStyle = style;
  }
  const baseProfile = profileToProps(profiles[profileName]);
  if (legacyPStyle) baseProfile.para.pStyle = legacyPStyle;
  const captionProfile = profileToProps(profiles.caption);

  const inlineCodeRun = {
    rStyle: inlineCodeCfg.rStyle === undefined ? templateStyle("CodeChar") : (inlineCodeCfg.rStyle || null),
    font: inlineCodeCfg.font || null,
    size: halfPoints(inlineCodeCfg.size),
    color: hexColor(inlineCodeCfg.color),
    shading: hexColor(inlineCodeCfg.shading),
  };
  const codeBlockPara = {
    pStyle: codeBlockCfg.pStyle === undefined ? templateStyle("Code") : (codeBlockCfg.pStyle || null),
    shading: hexColor(codeBlockCfg.shading),
  };
  if (codeBlockCfg.spacingBefore !== undefined && codeBlockCfg.spacingBefore !== null && codeBlockCfg.spacingBefore !== "") codeBlockPara.spacingBefore = Number(codeBlockCfg.spacingBefore);
  if (codeBlockCfg.spacingAfter !== undefined && codeBlockCfg.spacingAfter !== null && codeBlockCfg.spacingAfter !== "") codeBlockPara.spacingAfter = Number(codeBlockCfg.spacingAfter);
  if (codeBlockCfg.lineSpacing) codeBlockPara.lineSpacing = Number(codeBlockCfg.lineSpacing);
  const codeBlockRun = {
    font: codeBlockCfg.font || null,
    size: halfPoints(codeBlockCfg.size),
    color: hexColor(codeBlockCfg.color),
  };
  const linkRun = {
    rStyle: linkCfg.rStyle === undefined ? templateStyle("PwndocLink") : (linkCfg.rStyle || null),
    color: hexColor(linkCfg.color),
    underline: linkCfg.underline === undefined ? false : !!linkCfg.underline,
  };

  // ---- state -------------------------------------------------------------
  const blocks = [];          // top level output
  let para = null;            // current paragraph {props, runs, profile}
  const marks = [];           // stack of run property overlays from inline tags
  const lists = [];           // stack of {type, numId}
  const availableListIds = Array.isArray(listIds) ? listIds.slice() : [];
  let inPre = false;
  let inCodeInline = 0;
  let link = null;            // {href}
  let blockquoteDepth = 0;
  const tables = [];          // stack of table builders
  const ignoreDepth = { value: 0 }; // depth inside ignored elements (colgroup, img...)
  let openIgnored = [];

  function currentTable() { return tables.length ? tables[tables.length - 1] : null; }
  function currentCell() { const t = currentTable(); return t && t.currentRow ? t.currentCell : null; }

  function emitBlock(xml) {
    const cell = currentCell();
    if (cell) cell.blocks.push(xml);
    else blocks.push(xml);
  }

  function effectiveRunProps() {
    // base font from the paragraph profile, then inline marks on top
    const props = Object.assign({}, para ? para.runBase : baseProfile.run);
    for (const m of marks) Object.assign(props, m);
    if (inCodeInline > 0 && !inPre) {
      if (inlineCodeRun.rStyle) props.rStyle = inlineCodeRun.rStyle;
      if (inlineCodeRun.font) props.font = inlineCodeRun.font;
      if (inlineCodeRun.size) props.size = inlineCodeRun.size;
      if (inlineCodeRun.color) props.color = inlineCodeRun.color;
      if (inlineCodeRun.shading) props.shading = inlineCodeRun.shading;
    }
    if (link) {
      if (linkRun.rStyle) props.rStyle = linkRun.rStyle;
      if (linkRun.color) props.color = linkRun.color;
      if (linkRun.underline) props.underline = true;
    }
    return props;
  }

  function openParagraph(props, runBase) {
    if (para) closeParagraph();
    para = { props: props || {}, runBase: runBase || baseProfile.run, runs: [], hasText: false };
  }

  // An <li> whose paragraph never received content (e.g. <li><ul>...) must not
  // produce an empty bullet.
  function discardEmptyListParagraph() {
    if (para && para.props.numbering && para.runs.length === 0) para = null;
  }

  function closeParagraph() {
    if (!para) return;
    const p = para;
    para = null;
    const pPr = Object.assign({}, p.props);
    // paragraph mark inherits the base run formatting (font/size) so empty
    // lines and line heights follow the profile
    if (!pPr.markRunProps && (p.runBase.font || p.runBase.size)) {
      pPr.markRunProps = { font: p.runBase.font, size: p.runBase.size };
    }
    const runs = p.runs.map((r) => (typeof r === "string" ? r : textRun(r.rPr, r.text))).join("");
    emitBlock(`<w:p>${paraPropsXml(pPr)}${runs}</w:p>`);
  }

  function ensureParagraph() {
    if (!para) {
      const props = Object.assign({}, baseProfile.para);
      if (blockquoteDepth) props.indentLeft = 720 * blockquoteDepth;
      openParagraph(props);
    }
  }

  function textRun(rPr, text) {
    return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  }

  // Adjacent text with identical properties is merged into a single run
  // (the parser delivers entities as separate text chunks).
  function addTextRun(text) {
    if (text === "") return;
    ensureParagraph();
    const rPr = runPropsXml(effectiveRunProps());
    const last = para.runs[para.runs.length - 1];
    if (last && typeof last === "object" && last.rPr === rPr) {
      last.text += text;
    } else {
      para.runs.push({ rPr, text });
    }
    para.hasText = true;
  }

  function addRawRun(xml) {
    ensureParagraph();
    para.runs.push(xml);
  }

  function addBreak() {
    addRawRun(`<w:r><w:br/></w:r>`);
  }

  function addHyperlink(text, href, props) {
    ensureParagraph();
    const rPr = runPropsXml(props);
    if (/^#/.test(href) || href === "") {
      // internal reference to another finding: no target in the document
      para.runs.push({ rPr, text });
      para.hasText = true;
      return;
    }
    const url = escapeXml(href.replace(/"/g, "%22"));
    addRawRun(
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText xml:space="preserve"> HYPERLINK "${url}" </w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
      textRun(rPr, text) +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>`
    );
    para.hasText = true;
  }

  const bulletNumId = parseInt(styles.bulletNumId, 10) || BULLET_NUM_ID;

  function listLevel() { return Math.min(lists.length - 1, MAX_LIST_LEVEL); }

  function openListItemParagraph() {
    const props = Object.assign({}, baseProfile.para);
    delete props.pStyle;
    props.pStyle = templateStyle("ListParagraph");
    if (lists.length > 0) {
      const list = lists[lists.length - 1];
      props.numbering = { numId: list.numId, level: listLevel() };
    } else {
      // <li> without a parent list: treat as a bullet (historical behaviour)
      props.numbering = { numId: bulletNumId, level: 0 };
    }
    openParagraph(props);
  }

  function openCodeBlockParagraph() {
    const props = Object.assign({}, codeBlockPara);
    const runBase = {};
    if (codeBlockRun.font) runBase.font = codeBlockRun.font;
    if (codeBlockRun.size) runBase.size = codeBlockRun.size;
    if (codeBlockRun.color) runBase.color = codeBlockRun.color;
    openParagraph(props, runBase);
  }

  // ---- tables ------------------------------------------------------------
  function openTable() {
    tables.push({ colWidths: [], rows: [], currentRow: null, currentCell: null, inColgroup: false });
  }

  function openRow() {
    const t = currentTable();
    if (!t) return;
    t.currentRow = { cells: [] };
  }

  function openCell(attribs, header) {
    const t = currentTable();
    if (!t) return;
    if (!t.currentRow) openRow();
    t.currentCell = {
      header: !!header,
      colspan: Math.max(1, parseInt(attribs.colspan, 10) || 1),
      rowspan: Math.max(1, parseInt(attribs.rowspan, 10) || 1),
      colwidth: attribs.colwidth ? String(attribs.colwidth).split(",").map((v) => parseInt(v, 10) || 0) : null,
      blocks: [],
    };
  }

  function closeCell() {
    const t = currentTable();
    if (!t || !t.currentCell) return;
    if (para) closeParagraph();
    const cell = t.currentCell;
    t.currentCell = null;
    if (cell.blocks.length === 0) {
      const pPr = Object.assign({}, baseProfile.para);
      cell.blocks.push(`<w:p>${paraPropsXml(pPr)}</w:p>`);
    }
    t.currentRow.cells.push(cell);
  }

  function closeRow() {
    const t = currentTable();
    if (!t || !t.currentRow) return;
    if (t.currentCell) closeCell();
    t.rows.push(t.currentRow);
    t.currentRow = null;
  }

  function closeTable() {
    const t = tables.pop();
    if (!t) return;
    if (t.currentRow) { t.rows.push(t.currentRow); t.currentRow = null; }
    if (t.rows.length === 0) return;

    // Layout: compute grid with row/col spans
    const pending = {}; // colIndex -> {remaining, span}
    let colCount = 0;
    const layoutRows = [];
    for (const row of t.rows) {
      const placed = [];
      let col = 0;
      const placeMerged = () => {
        while (pending[col]) {
          const m = pending[col];
          placed.push({ continuation: true, colspan: m.span, col });
          m.remaining -= 1;
          if (m.remaining <= 0) delete pending[col];
          col += m.span;
        }
      };
      for (const cell of row.cells) {
        placeMerged();
        placed.push(Object.assign({ col }, cell));
        if (cell.rowspan > 1) pending[col] = { remaining: cell.rowspan - 1, span: cell.colspan };
        col += cell.colspan;
      }
      placeMerged();
      colCount = Math.max(colCount, col);
      layoutRows.push(placed);
    }
    if (colCount === 0) return;

    // Column widths (pixels from <colgroup> or colwidth attributes)
    const widths = new Array(colCount).fill(0);
    t.colWidths.forEach((w, i) => { if (i < colCount && w) widths[i] = w; });
    for (const placed of layoutRows) {
      for (const cell of placed) {
        if (cell.continuation || !cell.colwidth) continue;
        cell.colwidth.forEach((w, i) => {
          if (cell.col + i < colCount && w && !widths[cell.col + i]) widths[cell.col + i] = w;
        });
      }
    }
    const known = widths.filter((w) => w > 0);
    const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
    const normalized = widths.map((w) => (w > 0 ? w : avg));
    const total = normalized.reduce((a, b) => a + b, 0);
    const fractions = normalized.map((w) => w / total);

    const tblGrid = fractions.map((f) => `<w:gridCol w:w="${Math.round(f * TABLE_WIDTH_DXA)}"/>`).join("");
    let xml = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/>` +
      `<w:tblBorders>` +
      `<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `</w:tblBorders><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>` +
      `<w:tblGrid>${tblGrid}</w:tblGrid>`;

    for (const placed of layoutRows) {
      const isHeader = placed.some((c) => !c.continuation && c.header);
      xml += `<w:tr>${isHeader ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}`;
      for (const cell of placed) {
        let frac = 0;
        for (let i = 0; i < cell.colspan; i++) frac += fractions[cell.col + i] || 0;
        let tcPr = `<w:tcW w:w="${Math.round(frac * 5000)}" w:type="pct"/>`;
        if (cell.colspan > 1) tcPr += `<w:gridSpan w:val="${cell.colspan}"/>`;
        if (cell.continuation) tcPr += `<w:vMerge/>`;
        else if (cell.rowspan > 1) tcPr += `<w:vMerge w:val="restart"/>`;
        const content = cell.continuation ? `<w:p>${paraPropsXml(baseProfile.para)}</w:p>` : cell.blocks.join("");
        xml += `<w:tc><w:tcPr>${tcPr}</w:tcPr>${content}</w:tc>`;
      }
      xml += `</w:tr>`;
    }
    xml += `</w:tbl>`;
    emitBlock(xml);
  }

  // ---- parser ------------------------------------------------------------
  const parser = new htmlparser.Parser(
    {
      onopentag(tag, attribs) {
        if (openIgnored.length) { openIgnored.push(tag); return; }
        switch (tag) {
          case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
            openParagraph({ pStyle: templateStyle("Heading" + tag[1]) }, {});
            break;
          case "p":
          case "div": {
            if (para && para.props.numbering && para.runs.length === 0) {
              // <li><p> : the list item paragraph is already open, reuse it
              break;
            }
            const props = Object.assign({}, baseProfile.para);
            if (blockquoteDepth) props.indentLeft = 720 * blockquoteDepth;
            if (lists.length > 0) {
              // additional paragraph inside a list item: align with the text
              props.pStyle = templateStyle("ListParagraph");
              props.indentLeft = 720 * (listLevel() + 1);
            }
            openParagraph(props);
            break;
          }
          case "blockquote":
            if (para) closeParagraph();
            blockquoteDepth += 1;
            break;
          case "hr":
            if (para) closeParagraph();
            emitBlock(`<w:p>${paraPropsXml(Object.assign({}, baseProfile.para, { borderBottom: true }))}</w:p>`);
            break;
          case "br":
            addBreak();
            break;
          case "pre":
            inPre = true;
            openCodeBlockParagraph();
            break;
          case "code":
            inCodeInline += 1;
            break;
          case "b": case "strong":
            marks.push({ bold: true });
            break;
          case "i": case "em":
            marks.push({ italic: true });
            break;
          case "u":
            marks.push({ underline: true });
            break;
          case "s": case "strike": case "del":
            marks.push({ strike: true });
            break;
          case "mark": {
            const color = (attribs["data-color"] || "").toLowerCase();
            if (HIGHLIGHT_MAP[color]) marks.push({ highlight: HIGHLIGHT_MAP[color] });
            else if (hexColor(color)) marks.push({ shading: hexColor(color) });
            else marks.push({ highlight: "yellow" });
            break;
          }
          case "span": {
            const cls = attribs.class || "";
            if (inPre && highlightSyntax) {
              const key = cls.split(/\s+/).find((c) => syntaxColors[c]);
              marks.push(key ? { color: hexColor(syntaxColors[key]) } : {});
            } else {
              marks.push({});
            }
            break;
          }
          case "a":
            link = { href: attribs.href || "", text: "" };
            break;
          case "ul":
            discardEmptyListParagraph();
            if (para) closeParagraph();
            lists.push({ type: "bullet", numId: bulletNumId });
            break;
          case "ol": {
            discardEmptyListParagraph();
            if (para) closeParagraph();
            let numId;
            const parentNumbered = lists.length && lists[lists.length - 1].type === "number" ? lists[lists.length - 1].numId : null;
            if (parentNumbered) numId = parentNumbered;
            else if (availableListIds.length) numId = parseInt(availableListIds.shift(), 10) || NUMBERED_NUM_ID;
            else numId = NUMBERED_NUM_ID;
            lists.push({ type: "number", numId });
            break;
          }
          case "li":
            openListItemParagraph();
            break;
          case "table":
            if (para) closeParagraph();
            openTable();
            break;
          case "colgroup":
            if (currentTable()) currentTable().inColgroup = true;
            break;
          case "col": {
            const t = currentTable();
            if (t) {
              const m = /width:\s*(\d+(?:\.\d+)?)px/.exec(attribs.style || "");
              t.colWidths.push(m ? parseFloat(m[1]) : 0);
            }
            break;
          }
          case "thead": case "tbody": case "tfoot":
            break;
          case "tr":
            if (currentTable()) { if (currentTable().currentRow) closeRow(); openRow(); }
            break;
          case "td": case "th":
            if (currentTable()) { if (currentCell()) closeCell(); openCell(attribs, tag === "th"); if (tag === "th") marks.push({ bold: true }); }
            break;
          case "figure":
            if (para) closeParagraph();
            break;
          case "figcaption":
            openParagraph(Object.assign({}, captionProfile.para, captionProfile.para.alignment ? {} : { alignment: "center" }), captionProfile.run);
            break;
          case "legend": {
            // legacy caption element: <legend label="Figure" alt="text">
            const label = attribs.label || "Figure";
            openParagraph(Object.assign({}, captionProfile.para, captionProfile.para.alignment ? {} : { alignment: "center" }), captionProfile.run);
            const rPr = runPropsXml(effectiveRunProps());
            addTextRun(label + " ");
            addRawRun(
              `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
              `<w:r><w:instrText xml:space="preserve"> SEQ ${escapeXml(label)} \\* ARABIC </w:instrText></w:r>` +
              `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
              textRun(rPr, "1") +
              `<w:r><w:fldChar w:fldCharType="end"/></w:r>`
            );
            if (attribs.alt && attribs.alt !== "undefined") addTextRun(" - " + attribs.alt);
            break;
          }
          case "img":
          case "script":
          case "style":
            openIgnored.push(tag);
            break;
          default:
            break;
        }
      },

      ontext(text) {
        if (openIgnored.length) return;
        if (currentTable() && !currentCell()) return; // whitespace between rows/cells
        if (link) { link.text += text; return; }
        if (inPre) {
          if (!para) openCodeBlockParagraph();
          const lines = text.split("\n");
          lines.forEach((line, i) => {
            if (i > 0) addBreak();
            if (line !== "") addTextRun(line);
          });
          return;
        }
        if (!para && text.trim() === "") return; // whitespace between blocks
        // newlines inside a paragraph become line breaks (historical behaviour)
        const lines = text.split("\n");
        lines.forEach((line, i) => {
          if (i > 0) addBreak();
          if (line !== "") addTextRun(line);
        });
      },

      onclosetag(tag) {
        if (openIgnored.length) {
          if (openIgnored[openIgnored.length - 1] === tag) openIgnored.pop();
          return;
        }
        switch (tag) {
          case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
          case "p": case "div":
            closeParagraph();
            break;
          case "blockquote":
            if (para) closeParagraph();
            blockquoteDepth = Math.max(0, blockquoteDepth - 1);
            break;
          case "pre":
            closeParagraph();
            inPre = false;
            break;
          case "code":
            inCodeInline = Math.max(0, inCodeInline - 1);
            break;
          case "b": case "strong": case "i": case "em": case "u": case "s": case "strike": case "del": case "mark": case "span":
            marks.pop();
            break;
          case "a":
            if (link) {
              const l = link;
              const props = effectiveRunProps(); // computed while the link is active
              link = null;
              if (l.text !== "") addHyperlink(l.text, l.href, props);
            }
            break;
          case "li":
            discardEmptyListParagraph();
            if (para) closeParagraph();
            break;
          case "ul": case "ol":
            discardEmptyListParagraph();
            if (para) closeParagraph();
            lists.pop();
            break;
          case "colgroup":
            if (currentTable()) currentTable().inColgroup = false;
            break;
          case "td": case "th":
            if (currentTable()) { if (tag === "th") marks.pop(); closeCell(); }
            break;
          case "tr":
            closeRow();
            break;
          case "table":
            closeTable();
            break;
          case "figcaption":
          case "legend":
            closeParagraph();
            break;
          default:
            break;
        }
      },

      onend() {
        if (para) closeParagraph();
        while (tables.length) closeTable();
      },
    },
    { decodeEntities: true }
  );

  parser.write(html);
  parser.end();

  return blocks.join("");
}

module.exports = html2ooxml;
