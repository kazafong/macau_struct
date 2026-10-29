(function () {
  const STEPS = [
    ["params", "設計參數"],
    ["sources", "圖則與文字"],
    ["draft", "草稿複核"],
    ["pay", "模擬付款"],
    ["sign", "簽署下載"],
  ];

  const CHECKS = [
    ["steel", "鋼構件"],
    ["beam", "既有梁"],
    ["column", "既有柱"],
    ["slab", "既有板"],
    ["opening", "樓板開孔"],
    ["anchor", "錨栓"],
    ["connection", "焊縫與其他連接"],
    ["stability", "穩定"],
    ["stage", "施工階段"],
    ["service", "使用性"],
  ];

  const TYPE_COPY = {
    A: ["鋼樓梯", "梯段、平台、支承及連接"],
    B: ["樓板開孔／擴孔", "既有板、周邊鋼構、荷載路徑及施工階段"],
    C: ["鋼閣樓", "樓面、梁柱、穩定、支承及使用荷載"],
  };

  const INSTRUCTION = /忽略(以上|先前|之前|全部)|ignore previous|system\s*:|你現在是|do not follow|<\/?system>/i;

  const state = {
    step: "params",
    reached: { params: true },
    project: {
      number: "MS-PROTO-001",
      client: "",
      place: "澳門",
      use: "",
      engineer: "",
    },
    types: { A: false, B: false, C: false },
    deliverables: { calc: true, drawings: true, report: true },
    basis: {
      code: "unset",
      codeCustom: "",
      scheme: "",
      live: "",
      liveStatus: "未知",
      dead: "",
      deadStatus: "未知",
      support: "",
      supportStatus: "未知",
      stage: "",
      stageStatus: "未知",
      steel: "",
      steelStatus: "未知",
      concrete: "",
      concreteStatus: "未知",
      anchor: "",
      anchorStatus: "未知",
      geom: {
        stairWidth: "",
        riser: "",
        going: "",
        landing: "",
        opening: "",
        slabThickness: "",
        openingRelation: "",
        mezzSize: "",
        span: "",
        clearHeight: "",
      },
    },
    checks: {
      steel: true,
      beam: true,
      column: true,
      slab: true,
      opening: true,
      anchor: true,
      connection: true,
      stability: true,
      stage: true,
      service: true,
    },
    sources: { text: "", textStatus: "未知", cad: null },
    draft: null,
    draftStale: false,
    review: { watermark: false, unchecked: false, gaps: false, anchor: false, note: "" },
    payment: null,
    signature: null,
    frozen: null,
    pdfReady: false,
    pdfName: "",
    events: [],
    errors: [],
    agentLines: [],
    agentRunning: false,
    chromeOk: true,
  };

  const main = document.getElementById("main");
  const side = document.getElementById("side");
  const stepsEl = document.getElementById("steps");

  function log(action, detail) {
    state.events.push({ t: new Date().toISOString(), action: action, detail: detail || "" });
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function selectedTypes() {
    return ["A", "B", "C"].filter(function (key) { return state.types[key]; });
  }

  function typeLabel() {
    const keys = selectedTypes();
    if (!keys.length) return "未選";
    return keys.map(function (key) { return key + " " + TYPE_COPY[key][0]; }).join("、");
  }

  function fingerprint() {
    return JSON.stringify({
      project: state.project,
      types: state.types,
      deliverables: state.deliverables,
      basis: state.basis,
      checks: state.checks,
      text: state.sources.text,
      textStatus: state.sources.textStatus,
      cad: state.sources.cad ? state.sources.cad.name + ":" + state.sources.cad.size : "",
    });
  }

  function markDirty() {
    if (!state.draft) return;
    const stale = fingerprint() !== state.draft.fingerprint;
    if (stale && !state.draftStale) {
      log("輸入變更", "草稿、模擬付款與簽署失效，需重新產生");
    }
    state.draftStale = stale;
    if (stale) {
      state.payment = null;
      state.signature = null;
      state.frozen = null;
      state.pdfReady = false;
      state.review = { watermark: false, unchecked: false, gaps: false, anchor: false, note: state.review.note };
    }
  }

  function setPath(path, value) {
    const parts = path.split(".");
    let cur = state;
    for (let i = 0; i < parts.length - 1; i += 1) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = value;
  }

  function statusChip(status) {
    const kind = { "已確認": "ok", "假設": "assume", "未知": "unknown", "衝突": "conflict" }[status] || "unknown";
    return '<span class="chip ' + kind + '">' + esc(status || "未知") + "</span>";
  }

  function field(label, path, placeholder) {
    const parts = path.split(".");
    let value = state;
    parts.forEach(function (part) { value = value[part]; });
    return (
      '<label class="field"><span>' + label + "</span>" +
      '<input type="text" data-bind="' + path + '" value="' + esc(value) + '" placeholder="' + esc(placeholder || "") + '">' +
      "</label>"
    );
  }

  function statusSelect(path) {
    const parts = path.split(".");
    let value = state;
    parts.forEach(function (part) { value = value[part]; });
    return (
      "<select data-bind=\"" + path + "\">" +
      ["已確認", "假設", "未知", "衝突"].map(function (item) {
        return "<option" + (item === value ? " selected" : "") + ">" + item + "</option>";
      }).join("") +
      "</select>"
    );
  }

  function pair(label, valuePath, statusPath, placeholder) {
    return (
      '<label class="field"><span>' + label + "</span>" +
      '<div class="rowline"><input type="text" data-bind="' + valuePath + '" value="' + esc(getPath(valuePath)) + '" placeholder="' + esc(placeholder || "") + '">' +
      statusSelect(statusPath) +
      "</div></label>"
    );
  }

  function getPath(path) {
    let value = state;
    path.split(".").forEach(function (part) { value = value[part]; });
    return value;
  }

  function blank(value, fallback) {
    const text = String(value || "").trim();
    return text || fallback;
  }

  function cadSummary(excerpt) {
    const lines = String(excerpt || "").split(/\r?\n/).map(function (line) { return line.trim(); });
    const notes = [];
    const layers = [];
    let entity = "";
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (lines[i] === "0") entity = lines[i + 1];
      if (entity === "LAYER" && lines[i] === "2" && lines[i + 1] && layers.indexOf(lines[i + 1]) === -1) layers.push(lines[i + 1]);
      if ((entity === "TEXT" || entity === "MTEXT") && lines[i] === "1" && lines[i + 1]) notes.push(lines[i + 1]);
    }
    if (!layers.length && !notes.length) return "檔案已登記。裡面沒有讀到圖層名稱或文字標註，幾何仍未解析。";
    const bits = [];
    if (layers.length) bits.push("圖層：" + layers.join("、"));
    if (notes.length) bits.push("圖內文字：" + notes.join("；"));
    return bits.join("。") + "。這些只是檔裡的字，不是計算結果。";
  }

  function codeText() {
    if (state.basis.code === "provisional") return "工程師暫選：現行適用規範，版本待核對。系統不認定適用。";
    if (state.basis.code === "custom") return blank(state.basis.codeCustom, "已選自填但未填寫");
    return "尚未選定。系統不代為認定法規。";
  }

  function looksLikeInstruction(text) {
    return INSTRUCTION.test(text || "");
  }

  function buildGaps() {
    const gaps = [];
    if (state.basis.code === "unset") {
      gaps.push("規範與版本尚未選定。系統不代為認定哪一套法規適用。");
    }
    if (state.basis.code === "provisional") {
      gaps.push("規範只是工程師暫選，版本未核對。結果不能寫成已符合現行法規。");
    }
    if (!state.basis.support.trim() || state.basis.supportStatus === "未知" || state.basis.supportStatus === "衝突") {
      gaps.push("既有支承資料不足或有衝突。草稿只列出調查需要，不補造截面、配筋或強度。");
    }
    if (state.checks.anchor && (!state.basis.anchor.trim() || state.basis.anchorStatus === "未知" || state.basis.anchorStatus === "衝突")) {
      gaps.push("錨栓規格未確認或互相衝突。M12 與 M20 不能當成同一組已確認錨栓。");
    }
    if (state.checks.slab && state.basis.concreteStatus !== "已確認") {
      gaps.push("既有混凝土或配筋未確認。母體構件檢查保持未檢查。");
    }
    if (!state.sources.cad) {
      gaps.push("未上傳圖則。構件位置不能跟圖紙對照。");
    }
    if (!state.sources.text.trim()) {
      gaps.push("沒有自由文字補充。來源說明保持空白。");
    }
    return gaps;
  }

  function buildMembers() {
    const g = state.basis.geom;
    const rows = [];
    if (state.types.A) {
      rows.push(["ST-01", "鋼樓梯梯段", "新增", g.stairWidth ? "梯寬 " + g.stairWidth + " mm" : "梯寬未填", "未核定", "未檢查"]);
      rows.push(["ST-02", "樓梯平台", "新增", blank(g.landing, "平台尺寸未填"), "未核定", "未檢查"]);
      rows.push(["ST-03", "樓梯支承", "新增，交到既有結構", blank(state.basis.support, "支承未確認"), "未核定", "未檢查"]);
    }
    if (state.types.B) {
      rows.push(["OP-01", "樓板開孔／擴孔", "拆除範圍", blank(g.opening, "開孔尺寸未填"), "—", "未檢查"]);
      rows.push(["BM-01", "開孔周邊鋼構", "新增", blank(g.openingRelation, "與既有構件關係未填"), "未核定", "未檢查"]);
    }
    if (state.types.C) {
      rows.push(["MZ-01", "閣樓主梁", "新增", g.span ? "梁跨 " + g.span : "梁跨未填", "未核定", "未檢查"]);
      rows.push(["MZ-02", "閣下次梁與樓面", "新增", blank(g.mezzSize, "平面未填"), "未核定", "未檢查"]);
      rows.push(["CL-01", "閣樓柱", "新增", "支承點待圖則核對", "未核定", "未檢查"]);
      rows.push(["BR-01", "穩定支撐", "新增", "佈置未核定", "未核定", "未檢查"]);
    }
    rows.push(["AB-01", "錨栓群", "連接", blank(state.basis.anchor, "規格未知"), "未核定", "未檢查"]);
    rows.push(["HB-01", "錨栓母體構件", "既有", blank(state.basis.concrete, "母體資料未知"), "不與錨栓合併", "未檢查"]);
    if (selectedTypes().length > 1) {
      rows.push(["EX-01", "既有共用支承", "既有", "各類反力可能疊在同一構件", "未核定", "未檢查"]);
    }
    return rows;
  }

  function buildChecks() {
    const rows = CHECKS.map(function (item) {
      const on = state.checks[item[0]];
      if (!on) {
        return [item[1], "不適用", "工程師未把這項列入本次所需檢查。"];
      }
      return [item[1], "未檢查", "未連接 SAP2000 或已驗證 Excel，沒有可標成完成的結果。"];
    });
    rows.push([
      "錨栓母體構件",
      "未檢查",
      state.checks.anchor
        ? "與錨栓分開列示。混凝土錐體、邊距等母體模式未執行，也沒有被略過或判成合格。"
        : "工程師未勾選錨栓。母體模式仍列出，避免被默默略過。",
    ]);
    rows.push([
      "錨栓本體失效模式",
      state.checks.anchor ? "未檢查" : "不適用",
      state.checks.anchor
        ? "鋼材受拉、拔出、撬力未執行。原型沒有把它們判成合格。"
        : "工程師未把錨栓列入本次檢查。",
    ]);
    return rows;
  }

  function buildDraft() {
    const text = state.sources.text;
    const excerpt = state.sources.cad && state.sources.cad.excerpt ? state.sources.cad.excerpt : "";
    const instructionHit = looksLikeInstruction(text) || looksLikeInstruction(excerpt);
    const gaps = buildGaps();
    const lines = [
      "讀取項目、" + typeLabel() + " 與交付範圍",
      "保存設計基礎快照；不認定法規適用",
      state.sources.cad ? "登記圖則 " + state.sources.cad.name + "；不解析幾何，不寫回原檔" : "沒有圖則可登記",
      instructionHit ? "自由文字或圖檔含看似指令的內容，只作資料保存，不執行" : "自由文字只作資料保存",
      selectedTypes().length > 1 ? "組合項目：標明可能共用的既有支承，不把幾份計算事後拼合" : "單一範圍：仍分開列出錨栓與母體",
      "所需檢查全部保持未檢查或部分不適用，並寫明原因",
      gaps.length ? "列出 " + gaps.length + " 項資料缺口，不補造假設" : "輸入裡沒有額外的空白缺口需要補造",
      "寫上草稿水印、來源狀態與審計事件",
    ];
    return {
      id: state.project.number + "-D" + (state.events.filter(function (event) { return event.action === "產生草稿"; }).length + 1),
      at: new Date().toISOString(),
      fingerprint: fingerprint(),
      lines: lines,
      gaps: gaps,
      members: buildMembers(),
      checks: buildChecks(),
      instructionHit: instructionHit,
      combo: selectedTypes().length > 1,
    };
  }

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleString("zh-Hant-HK", { hour12: false });
    } catch (err) {
      return iso;
    }
  }

  function schematic() {
    const parts = ['<rect class="slab" x="16" y="16" width="368" height="188"></rect>',
      '<text x="26" y="36">現有樓板範圍（示意，比例不準）</text>'];
    if (state.types.B) {
      parts.push('<rect class="demo" x="168" y="78" width="120" height="62"></rect>');
      parts.push('<text x="228" y="114" text-anchor="middle">開孔</text>');
    }
    if (state.types.A) {
      parts.push('<path class="stair" d="M36 176 H92 V150 H140 V124 H188"></path>');
      parts.push('<text x="40" y="168">樓梯</text>');
    }
    if (state.types.C) {
      parts.push('<rect class="mezz" x="250" y="40" width="110" height="70"></rect>');
      parts.push('<text x="305" y="80" text-anchor="middle">閣樓</text>');
    }
    return '<svg class="schematic" viewBox="0 0 400 220" role="img" aria-label="結構示意，非施工圖">' + parts.join("") + "</svg>" +
      '<p class="legend"><span><i class="swatch"></i>現有</span><span><i class="swatch demo"></i>拆除／開孔</span><span><i class="swatch stair"></i>新增鋼構</span></p>';
  }

  function sheetHtml() {
    const project = state.project;
    const basis = state.basis;
    const g = basis.geom;
    const draft = state.draft;
    const signed = Boolean(state.signature);
    const deliverableText = [
      state.deliverables.calc ? "計算草稿" : "",
      state.deliverables.drawings ? "結構圖則草稿" : "",
      state.deliverables.report ? "報告草稿" : "",
    ].filter(Boolean).join("、") || "未選交付";
    const memberRows = draft.members.map(function (row) {
      return "<tr>" + row.map(function (cell) { return "<td>" + esc(cell) + "</td>"; }).join("") + "</tr>";
    }).join("");
    const checkRows = draft.checks.map(function (row) {
      return "<tr><td>" + esc(row[0]) + "</td><td>" + esc(row[1]) + "</td><td>" + esc(row[2]) + "</td></tr>";
    }).join("");
    const gapItems = draft.gaps.map(function (gap) { return "<li>" + esc(gap) + "</li>"; }).join("");
    const inputRows = [
      ["活載", basis.live ? basis.live + " kN/m²" : "未填", basis.liveStatus, "設計參數"],
      ["附加恆載", basis.dead ? basis.dead + " kN/m²" : "未填", basis.deadStatus, "設計參數"],
      ["鋼材", blank(basis.steel, "未填"), basis.steelStatus, "設計參數"],
      ["既有混凝土／配筋", blank(basis.concrete, "未填"), basis.concreteStatus, "設計參數"],
      ["錨栓", blank(basis.anchor, "未填"), basis.anchorStatus, "設計參數"],
      ["支承", blank(basis.support, "未填"), basis.supportStatus, "設計參數"],
      ["施工階段", blank(basis.stage, "未填"), basis.stageStatus, "設計參數"],
    ];
    if (state.types.A) {
      inputRows.push(["梯寬／梯級高／踏面", [g.stairWidth, g.riser, g.going].map(function (item) { return item || "—"; }).join(" / ") + " mm", "見設計參數", "幾何"]);
      inputRows.push(["平台", blank(g.landing, "未填"), "見設計參數", "幾何"]);
    }
    if (state.types.B) {
      inputRows.push(["開孔", blank(g.opening, "未填"), "見設計參數", "幾何"]);
      inputRows.push(["板厚", g.slabThickness ? g.slabThickness + " mm" : "未填", "見設計參數", "幾何"]);
      inputRows.push(["開孔與既有構件", blank(g.openingRelation, "未填"), "見設計參數", "幾何"]);
    }
    if (state.types.C) {
      inputRows.push(["閣樓平面", blank(g.mezzSize, "未填"), "見設計參數", "幾何"]);
      inputRows.push(["梁跨／淨高", blank(g.span, "未填") + " / " + blank(g.clearHeight, "未填"), "見設計參數", "幾何"]);
    }
    const inputTable = inputRows.map(function (row) {
      return "<tr><td>" + esc(row[0]) + "</td><td>" + esc(row[1]) + "</td><td>" + (row[2].indexOf("見") === 0 ? esc(row[2]) : statusChip(row[2])) + "</td><td>" + esc(row[3]) + "</td></tr>";
    }).join("");
    const cad = state.sources.cad;
    const reviewDone = state.review.watermark && state.review.unchecked && state.review.gaps && state.review.anchor;
    return (
      '<article class="sheet" id="sheet">' +
      '<header class="sheet-head"><div>' +
      '<p class="kicker">澳門 A&amp;A 結構工程 · 計算、圖則及報告草稿</p>' +
      "<h2>" + esc(blank(project.client, "未命名項目")) + "</h2>" +
      "<p class=\"meta\">" + esc(project.number) + " · " + esc(draft.id) + " · " + esc(project.place) + "</p>" +
      "</div>" +
      '<div class="chop' + (signed ? " signed" : "") + '"><div><b>' + (signed ? "已簽署" : "草稿") + "</b><small>" + (signed ? "本地原型" : "未經簽發") + "</small></div></div>" +
      "</header>" +
      '<p class="warn">此包是草稿。不代表主管機關批准，不是施工許可，也不是正式簽發。數值來自輸入或佔位標記，未經 SAP2000 或已驗證 Excel 重算。' +
      (signed ? " 簽名是本地筆跡，不是電子簽署服務商的簽署。" : "") + "</p>" +
      "<h3>1. 項目與範圍</h3>" +
      "<table><tbody>" +
      row("委託人", project.client) +
      row("用途", project.use) +
      row("地點", project.place) +
      row("負責工程師", project.engineer) +
      row("類別", typeLabel()) +
      row("交付", deliverableText) +
      "</tbody></table>" +
      "<p>" + esc(narrative()) + "</p>" +
      (draft.combo ? '<p class="callout">這是組合項目（' + esc(selectedTypes().map(function (key) { return TYPE_COPY[key][0]; }).join("、")) + '）。不能各自算完再拼在一起，反力可能落在同一條既有梁或同一塊板上，要一起看。</p>' : "") +
      "<h3>2. 設計基礎快照</h3>" +
      "<p class=\"hint\">由工程師在產生草稿前選定。系統沒有自行認定法規適用，也沒有在批准後改寫這份快照。</p>" +
      "<table><tbody>" +
      row("規範與版本", codeText()) +
      row("結構方案", blank(basis.scheme, "未填")) +
      "</tbody></table>" +
      "<table><thead><tr><th>輸入</th><th>數值</th><th>狀態</th><th>來源</th></tr></thead><tbody>" + inputTable + "</tbody></table>" +
      "<p class=\"hint\">長度欄按毫米理解，荷載欄按 kN/m² 理解。原型不換算、不組合極值、不輸出利用率。</p>" +
      "<h3>3. 資料台帳</h3>" +
      "<table><thead><tr><th>資料</th><th>登記</th><th>狀態</th></tr></thead><tbody>" +
      "<tr><td>結構底圖</td><td>" + (cad ? esc(cad.name) + " · " + Math.ceil(cad.size / 1024) + " KB" : "未上傳") + "</td><td>" + (cad ? "已登記檔名。幾何未解析。" : statusChip("未知")) + "</td></tr>" +
      "<tr><td>自由文字</td><td>" + esc(blank(state.sources.text, "（空白）")) + "</td><td>" + statusChip(state.sources.textStatus) + "</td></tr>" +
      "</tbody></table>" +
      (draft.instructionHit ? '<p class="warn">自由文字或圖檔裡有看似指令的句子。代理只把它留在資料欄，沒有照做。</p>' : "") +
      (cad && cad.excerpt ? "<h3>圖檔裡讀到的文字</h3><p>" + esc(cadSummary(cad.excerpt)) + "</p>" : "") +
      "<h3>4. 示意與圖則索引</h3>" +
      schematic() +
      "<table><thead><tr><th>圖號</th><th>內容</th><th>狀態</th></tr></thead><tbody>" +
      "<tr><td>S-SK-01</td><td>上圖結構示意。現有、拆除、新增只作圖例，沒有寫回 CAD。</td><td>草稿</td></tr>" +
      "<tr><td>S-SK-02</td><td>構件表，見下一節。</td><td>草稿</td></tr>" +
      "<tr><td>S-SK-03</td><td>連接表。錨栓 AB-01 與母體 HB-01 分開。</td><td>草稿</td></tr>" +
      "<tr><td>來源底圖</td><td>" + (cad ? esc(cad.name) : "無") + "</td><td>" + (cad ? "已上傳，未覆蓋" : "缺") + "</td></tr>" +
      "</tbody></table>" +
      "<h3>5. 構件與連接草表</h3>" +
      "<table class=\"marks-table\"><thead><tr><th>標記</th><th>構件</th><th>新舊</th><th>輸入依據</th><th>截面</th><th>檢查</th></tr></thead><tbody>" +
      memberRows + "</tbody></table>" +
      "<h3>6. 檢查</h3>" +
      "<table class=\"checks-table\"><thead><tr><th>項目</th><th>結果</th><th>原因</th></tr></thead><tbody>" + checkRows + "</tbody></table>" +
      "<h3>7. 調查需要與提醒</h3>" +
      (gapItems ? "<ul>" + gapItems + "</ul>" : "<p>這次輸入沒有另列資料缺口。檢查依然未完成。</p>") +
      '<div class="note"><strong>歷史樣本提醒。</strong> 2017 年澳門樣本裡，材料描述出現過 M12，後續某個連接用了 M20；既有梁配筋頁取過最小需求，圖上另有較大值。那是待核對的例子，不是對原設計安不安全的判斷，也不能拿來填本項目的未知欄。</div>' +
      "<h3>8. 本地代理紀錄</h3><ol>" +
      draft.lines.map(function (line) { return "<li>" + esc(line) + "</li>"; }).join("") +
      "</ol>" +
      (reviewDone ? "<h3>9. 複核</h3><p>工程師已確認：看過草稿限制、未檢查項不會被標成已核實、資料缺口仍然留著、錨栓與母體分開。" +
        (state.review.note ? " 備註：" + esc(state.review.note) : "") + "</p>" : "") +
      (state.payment ? "<h3>10. 模擬付款</h3>" + receiptBlock() : "") +
      "<h3>" + (state.payment ? "11" : "10") + ". 簽署</h3>" +
      signatureBlock() +
      '<table class="titleblock"><tbody><tr>' +
      "<td>澳門 A&amp;A 結構草稿</td><td>" + esc(project.number) + "</td><td>" + esc(draft.id) + "</td><td>" + (state.frozen ? "已凍結 " + esc(state.frozen.id) : "未凍結") + "</td>" +
      "</tr><tr><td colspan=\"4\">原型輸出 · 非許可 · 非主管機關批准 · " + esc(fmtTime(draft.at)) + "</td></tr></tbody></table>" +
      "</article>"
    );
  }

  function row(label, value) {
    return "<tr><th>" + label + "</th><td>" + esc(blank(value, "未填")) + "</td></tr>";
  }

  function narrative() {
    const bits = [];
    bits.push("本草稿記錄一項位於" + blank(state.project.place, "澳門") + "、用途為「" + blank(state.project.use, "未填") + "」的結構工作。");
    bits.push("範圍是" + typeLabel() + "。");
    if (state.basis.scheme.trim()) bits.push("工程師寫下的方案是：" + state.basis.scheme.trim());
    else bits.push("結構方案一欄還是空的。");
    bits.push("下面的構件標記只供複核時對照，截面都未核定。");
    return bits.join("");
  }

  function receiptBlock() {
    const pay = state.payment;
    return "<dl class=\"receipt\">" +
      "<dt>收據</dt><dd>" + esc(pay.id) + "</dd>" +
      "<dt>階段</dt><dd>付費初步評估（原型）</dd>" +
      "<dt>示範金額</dt><dd>MOP 1.00</dd>" +
      "<dt>狀態</dt><dd>已在本機模擬，沒有向卡組織送出交易</dd>" +
      "<dt>時間</dt><dd>" + esc(fmtTime(pay.at)) + "</dd>" +
      "</dl>";
  }

  function signatureBlock() {
    if (!state.signature) {
      return "<p>尚未簽署。只有負責工程師可以決定簽不簽。系統不會自動簽署或發出。</p>";
    }
    return "<p>" + esc(state.signature.name) + " 於 " + esc(fmtTime(state.signature.at)) + " 在本機留下筆跡。這不是電子簽署服務商的簽名，也不等於決定正式發出。</p>" +
      '<div class="sigbox"><img alt="本地簽名" src="' + state.signature.dataUrl + '"></div>';
  }

  function reviewReady() {
    return state.review.watermark && state.review.unchecked && state.review.gaps && state.review.anchor && state.draft && !state.draftStale;
  }

  function renderSteps() {
    stepsEl.innerHTML = STEPS.map(function (item, index) {
      const id = item[0];
      const on = state.step === id;
      const enabled = canOpen(id);
      return '<li class="' + (on ? "on" : "") + '"><button type="button" data-step="' + id + '"' + (enabled ? "" : " disabled") + ">" +
        '<span class="n">0' + (index + 1) + "</span>" + item[1] + "</button></li>";
    }).join("");
    stepsEl.querySelectorAll("button").forEach(function (button) {
      button.addEventListener("click", function () {
        const id = button.getAttribute("data-step");
        if (!canOpen(id)) return;
        state.step = id;
        state.errors = [];
        render();
      });
    });
  }

  function canOpen(id) {
    if (id === "params" || id === "sources") return Boolean(state.reached[id] || id === "params");
    if (id === "draft") return Boolean(state.draft);
    if (id === "pay") return reviewReady() || Boolean(state.payment);
    if (id === "sign") return Boolean(state.payment) && !state.draftStale;
    return false;
  }

  function renderSide() {
    const cad = state.sources.cad ? state.sources.cad.name : "未上傳";
    const rows = [
      ["步驟", labelOf(state.step)],
      ["項目", state.project.number],
      ["類別", typeLabel()],
      ["圖則", cad],
      ["文字", String(state.sources.text || "").trim().length + " 字"],
      ["草稿", state.draft ? state.draft.id + (state.draftStale ? "（已失效）" : "") : "未產生"],
      ["複核", reviewReady() ? "已確認" : "未完成"],
      ["付款", state.payment ? state.payment.id : "未模擬"],
      ["簽署", state.signature ? state.signature.name : "未簽"],
      ["版本", state.frozen ? state.frozen.id : "未凍結"],
    ];
    const events = state.events.slice(-6).reverse().map(function (event) {
      return "<li><strong>" + esc(event.action) + "</strong> " + esc(event.detail) + "</li>";
    }).join("");
    side.innerHTML = '<div class="side"><h2>原型狀態</h2><dl>' +
      rows.map(function (item) { return "<div><dt>" + item[0] + "</dt><dd>" + esc(item[1]) + "</dd></div>"; }).join("") +
      "</dl><ol class=\"events\">" + events + "</ol></div>";
  }

  function labelOf(id) {
    const found = STEPS.filter(function (item) { return item[0] === id; })[0];
    return found ? found[1] : id;
  }

  function errorBox() {
    if (!state.errors.length) return "";
    return '<div class="errors">' + state.errors.map(function (item) { return "<p>" + esc(item) + "</p>"; }).join("") + "</div>";
  }

  function renderMain() {
    if (state.step === "params") main.innerHTML = renderParams();
    else if (state.step === "sources") main.innerHTML = renderSources();
    else if (state.step === "draft") main.innerHTML = renderDraftStep();
    else if (state.step === "pay") main.innerHTML = renderPay();
    else main.innerHTML = renderSign();
    bindMain();
  }

  function renderParams() {
    return '<section class="panel"><h2>設計參數</h2>' +
      '<p class="lede">先把項目和設計基礎記下來。法規版本由你選，這裡不會替你認定適用。</p>' +
      errorBox() +
      "<h3>項目</h3><div class=\"grid\">" +
      field("項目編號", "project.number", "MS-PROTO-001") +
      field("委託人", "project.client", "商業裝修公司或業主") +
      field("地點", "project.place", "澳門半島、氹仔…") +
      field("用途", "project.use", "商業裝修、餐飲、零售") +
      field("負責工程師", "project.engineer", "有權檢查及簽署的人") +
      "</div>" +
      "<h3>服務範圍</h3><div class=\"choices\">" +
      typeChoice("A") + typeChoice("B") + typeChoice("C") +
      "</div>" +
      "<h3>交付</h3><div class=\"checks\">" +
      checkDelivery("calc", "計算草稿") +
      checkDelivery("drawings", "結構圖則草稿（這類服務通常包括圖則）") +
      checkDelivery("report", "報告草稿") +
      "</div>" +
      "<h3>設計基礎</h3>" +
      '<label class="field"><span>規範與版本</span><select data-bind="basis.code" data-rerender="1">' +
      option("unset", "尚未選定", state.basis.code) +
      option("provisional", "工程師暫選：現行適用規範，版本待核", state.basis.code) +
      option("custom", "自填版本", state.basis.code) +
      "</select></label>" +
      (state.basis.code === "custom" ? field("自填的規範與版本", "basis.codeCustom", "由工程師填寫，系統不代核") : "") +
      '<label class="field" style="margin-top:12px"><span>結構方案</span><textarea data-bind="basis.scheme" placeholder="例如：新造鋼樓梯支承於既有梁，樓板局部擴孔，孔邊加鋼梁。">' + esc(state.basis.scheme) + "</textarea></label>" +
      "<h3>幾何</h3>" +
      (state.types.A ? "<div class=\"grid\">" + field("梯寬 mm", "basis.geom.stairWidth", "1200") + field("梯級高 mm", "basis.geom.riser", "175") + field("踏面深 mm", "basis.geom.going", "250") + field("平台", "basis.geom.landing", "1200 × 1200") + "</div>" : "<p class=\"hint\">未選鋼樓梯。</p>") +
      (state.types.B ? "<div class=\"grid\">" + field("開孔平面", "basis.geom.opening", "1800 × 900") + field("板厚 mm", "basis.geom.slabThickness", "未知可留空") + '<label class="field span-2"><span>開孔與既有構件的關係</span><input type="text" data-bind="basis.geom.openingRelation" value="' + esc(state.basis.geom.openingRelation) + '"></label></div>' : "") +
      (state.types.C ? "<div class=\"grid\">" + field("閣樓平面", "basis.geom.mezzSize", "6 m × 4 m") + field("主梁跨度", "basis.geom.span", "6 m") + field("淨高", "basis.geom.clearHeight", "2.4 m") + "</div>" : "") +
      (!selectedTypes().length ? "<p class=\"hint\">先勾選 A、B 或 C，對應的幾何欄才出現。</p>" : "") +
      "<h3>材料、荷載、支承、施工階段</h3><div class=\"grid\">" +
      pair("活載", "basis.live", "basis.liveStatus", "kN/m²") +
      pair("附加恆載", "basis.dead", "basis.deadStatus", "kN/m²") +
      pair("鋼材", "basis.steel", "basis.steelStatus", "等級由工程師填") +
      pair("既有混凝土／配筋", "basis.concrete", "basis.concreteStatus", "未知就留白") +
      pair("錨栓規格", "basis.anchor", "basis.anchorStatus", "不要猜 M12 或 M20") +
      pair("支承", "basis.support", "basis.supportStatus", "既有梁、柱或板") +
      "</div>" +
      '<label class="field" style="margin-top:12px"><span>施工階段</span><div class="rowline"><textarea data-bind="basis.stage" placeholder="拆除順序、臨時支承、可否在使用中施工">' + esc(state.basis.stage) + "</textarea>" +
      statusSelect("basis.stageStatus") + "</div></label>" +
      "<h3>本次要檢查的項目</h3><div class=\"checks\">" +
      CHECKS.map(function (item) {
        return '<label><input type="checkbox" data-bind="checks.' + item[0] + '"' + (state.checks[item[0]] ? " checked" : "") + "> " + item[1] + "</label>";
      }).join("") +
      "</div>" +
      '<p class="hint">錨栓如果要查，母體構件會在草稿裡另開一行。缺資料不會在這裡被自動補上。</p>' +
      '<div class="actions"><button type="button" class="ghost" id="fill-sample">填入示範參數</button><button type="button" class="primary" id="to-sources">下一步：圖則與文字</button></div>' +
      "</section>";
  }

  function option(value, label, current) {
    return '<option value="' + value + '"' + (value === current ? " selected" : "") + ">" + label + "</option>";
  }

  function typeChoice(key) {
    return '<label class="choice"><input type="checkbox" data-bind="types.' + key + '" data-rerender="1"' + (state.types[key] ? " checked" : "") + ">" +
      "<span><strong>" + key + "　" + TYPE_COPY[key][0] + "</strong><br>" + TYPE_COPY[key][1] + "</span></label>";
  }

  function checkDelivery(key, label) {
    return '<label><input type="checkbox" data-bind="deliverables.' + key + '"' + (state.deliverables[key] ? " checked" : "") + "> " + label + "</label>";
  }

  function renderSources() {
    const cad = state.sources.cad;
    return '<section class="panel"><h2>圖則與文字</h2>' +
      '<p class="lede">上傳 CAD 類檔案，並用自己的話補充現場和資料來源。兩者都只當資料，不當指令。</p>' +
      errorBox() +
      '<div class="drop" id="drop"><div><strong>結構底圖</strong><p class="hint">DXF、DWG 或其他檔。原型只登記檔名、大小和可讀文字，不量幾何，也不改原檔。</p></div>' +
      '<input id="cad" type="file" accept=".dxf,.dwg,.pdf,.png,.txt"></div>' +
      (cad ? '<div class="filecard"><strong>' + esc(cad.name) + "</strong><p class=\"hint\">" + Math.ceil(cad.size / 1024) + " KB · 已放進資料台帳</p>" +
        (cad.excerpt ? "<pre class=\"excerpt\">" + esc(cad.excerpt.slice(0, 500)) + "</pre>" : "<p class=\"hint\">這個檔讀不出連續文字，只保留檔名與大小。</p>") +
        "</div>" : "") +
      '<p class="hint">沒有現成檔可以先用 <a href="/sample/macau-aa-sample.dxf" download>示範 DXF</a>，或<button type="button" class="linkish" id="use-sample">直接載入示範圖則</button>。</p>' +
      '<label class="field"><span>自由文字</span><textarea id="notes" data-bind="sources.text" placeholder="現場看到甚麼、哪張圖是誰給的、哪些尺寸還衝突。">' + esc(state.sources.text) + "</textarea></label>" +
      '<label class="field"><span>這段文字的狀態</span>' + statusSelect("sources.textStatus") + "</label>" +
      '<div class="actions"><button type="button" class="ghost" id="back-params">返回參數</button><button type="button" class="primary" id="generate"' + (state.agentRunning ? " disabled" : "") + ">產生結構草稿</button></div>" +
      (state.agentRunning || state.agentLines.length ? '<div class="agent"><p><strong>本地草稿代理</strong>　沒有外連模型。</p><ol>' +
        state.agentLines.map(function (line) { return '<li class="done">' + esc(line) + "</li>"; }).join("") +
        "</ol></div>" : "") +
      "</section>";
  }

  function renderDraftStep() {
    return (state.draftStale ? '<div class="errors"><p>參數或資料改過了。這份草稿、模擬付款和簽署都已失效，請回去重新產生。</p></div>' : "") +
      sheetHtml() +
      '<section class="dock"><h2>工程師複核</h2>' +
      '<p class="lede">逐項看過才可以往下。未檢查的項目不能在這裡改成已核實。</p>' +
      errorBox() +
      '<div class="choices">' +
      ack("review.watermark", "ack-watermark", "我看過草稿水印。這不是主管機關批准，也不是施工許可。") +
      ack("review.unchecked", "ack-unchecked", "未檢查的項目仍然未檢查。這份原型沒有 SAP2000 或 Excel 結果。") +
      ack("review.gaps", "ack-gaps", "資料缺口和調查需要保留原樣，沒有用假設填滿。") +
      ack("review.anchor", "ack-anchor", "錨栓和母體構件分開列了，我沒有把它們看成同一個合格結論。") +
      "</div>" +
      '<label class="field"><span>複核備註（可空白）</span><textarea data-bind="review.note" placeholder="例外、要退回的地方、還想查的資料">' + esc(state.review.note) + "</textarea></label>" +
      '<div class="actions"><button type="button" class="ghost" id="back-sources">返回資料</button><button type="button" class="primary" id="to-pay">複核完成，前往模擬付款</button></div>' +
      "</section>";
  }

  function ack(path, id, label) {
    const on = getPath(path);
    return '<label class="choice"><input type="checkbox" id="' + id + '" data-bind="' + path + '"' + (on ? " checked" : "") + "><span>" + label + "</span></label>";
  }

  function renderPay() {
    if (state.payment) {
      return '<section class="panel"><h2>模擬付款已記錄</h2><p class="lede">沒有支付服務商參與。</p>' +
        receiptBlock() +
        '<div class="actions"><button type="button" class="primary" id="to-sign">前往簽署</button></div></section>';
    }
    return '<section class="panel"><h2>模擬付款</h2>' +
      '<p class="lede">這一格對應「付費初步評估」：交代已有證據、限制和要調查的事。它不是施工許可，也不是正式委聘。</p>' +
      errorBox() +
      '<p class="price">MOP 1.00 <small>示範金額</small></p>' +
      '<p class="warn">尚未做過澳門市場報價調查，所以這裡不寫真實收費。MOP 1.00 只為讓付款步驟可以走完。按下去不會向銀行或卡組織送出任何交易。</p>' +
      "<table><thead><tr><th>項目</th><th>說明</th><th>金額</th></tr></thead><tbody>" +
      "<tr><td>初步評估草稿</td><td>本地組裝的草稿包</td><td>MOP 1.00</td></tr>" +
      "<tr><td>SAP2000／Excel 重算</td><td>未連接</td><td>不計</td></tr>" +
      "<tr><td>正式簽署及提交</td><td>不在這個原型</td><td>不計</td></tr>" +
      "</tbody></table>" +
      '<div class="grid" style="margin-top:14px">' +
      '<label class="field"><span>付款人（示範）</span><input id="payer" type="text" placeholder="姓名"></label>' +
      '<label class="field"><span>卡號（任意 12–19 位數字）</span><input id="card" type="text" inputmode="numeric" placeholder="4242424242424242"></label>' +
      '<label class="field"><span>到期</span><input id="exp" type="text" placeholder="12/30"></label>' +
      '<label class="field"><span>安全碼</span><input id="cvc" type="text" inputmode="numeric" placeholder="123"></label>' +
      "</div>" +
      '<p class="hint">格式對了就會通過。沒有收單機構可拒絕。</p>' +
      '<div class="actions"><button type="button" class="ghost" id="back-draft">返回草稿</button><button type="button" class="primary" id="pay">確認模擬付款</button></div>' +
      "</section>";
  }

  function renderSign() {
    const done = Boolean(state.frozen);
    return sheetHtml() +
      '<section class="dock"><h2>' + (done ? "版本已凍結" : "簽署並下載") + "</h2>" +
      (state.chromeOk ? "" : '<div class="errors"><p>這台電腦找不到 Google Chrome，PDF 會失敗。草稿仍可在頁面上看。</p></div>') +
      errorBox() +
      (done
        ? '<p class="okline">已凍結 ' + esc(state.frozen.id) + "。" + (state.pdfReady ? " PDF 已產生，可以再下載。" : " 若下載沒有開始，按下面的按鈕再試一次。") + " 這份簽名只存在這次開啟的頁面裡。</p>" +
          '<div class="actions"><button type="button" class="primary" id="download-again">再次下載 PDF</button><button type="button" class="ghost" id="reset">重開一個原型項目</button></div>'
        : '<p class="lede">簽名由你畫。它不會送到電子簽署服務商，也沒有法律上的電子簽署效力。</p>' +
          '<div class="grid"><label class="field"><span>簽署人</span><input id="signer" type="text" value="' + esc(state.project.engineer) + '"></label></div>' +
          '<p class="hint">在框裡簽名</p><div class="canvas-wrap"><canvas id="sign" width="900" height="220"></canvas></div>' +
          '<div class="actions"><button type="button" class="ghost" id="clear-sign">清除筆跡</button></div>' +
          '<div class="choices">' +
          '<label class="choice"><input type="checkbox" id="ack-sign-1"><span>我是負責檢查的工程師，決定在這個原型留下本地簽署。</span></label>' +
          '<label class="choice"><input type="checkbox" id="ack-sign-2"><span>我知道這不是電子簽署服務商，不構成法律上的電子簽署，也不代表主管機關批准。</span></label>' +
          '<label class="choice"><input type="checkbox" id="ack-sign-3"><span>我知道數值未經 SAP2000 或已驗證 Excel 重算，未檢查的項目仍然未檢查。</span></label>' +
          "</div>" +
          '<div class="actions"><button type="button" class="ghost" id="back-pay">返回付款</button><button type="button" class="primary" id="freeze">凍結此版本並下載 PDF</button></div>') +
      "</section>";
  }

  function bindMain() {
    main.querySelectorAll("[data-bind]").forEach(function (el) {
      const eventName = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
      el.addEventListener(eventName, function () {
        const value = el.type === "checkbox" ? el.checked : el.value;
        setPath(el.getAttribute("data-bind"), value);
        markDirty();
        if (state.errors.length) {
          state.errors = [];
          const box = main.querySelector(".errors");
          if (box) box.remove();
        }
        if (el.getAttribute("data-rerender")) render();
        else renderSide();
      });
    });

    const toSources = document.getElementById("to-sources");
    if (toSources) toSources.addEventListener("click", function () {
      state.errors = validateParams();
      if (state.errors.length) { render(); return; }
      state.reached.sources = true;
      state.step = "sources";
      log("前往資料", typeLabel());
      render();
    });

    const fill = document.getElementById("fill-sample");
    if (fill) fill.addEventListener("click", fillSample);

    const backParams = document.getElementById("back-params");
    if (backParams) backParams.addEventListener("click", function () { state.step = "params"; render(); });

    const cad = document.getElementById("cad");
    if (cad) cad.addEventListener("change", function () {
      if (cad.files && cad.files[0]) takeFile(cad.files[0]);
    });
    const drop = document.getElementById("drop");
    if (drop) {
      drop.addEventListener("dragover", function (event) { event.preventDefault(); });
      drop.addEventListener("drop", function (event) {
        event.preventDefault();
        if (event.dataTransfer.files && event.dataTransfer.files[0]) takeFile(event.dataTransfer.files[0]);
      });
    }
    const useSample = document.getElementById("use-sample");
    if (useSample) useSample.addEventListener("click", loadSampleFile);

    const generate = document.getElementById("generate");
    if (generate) generate.addEventListener("click", generateDraft);

    const toPay = document.getElementById("to-pay");
    if (toPay) toPay.addEventListener("click", function () {
      if (state.draftStale) {
        state.errors = ["草稿已失效，請重新產生。"];
        render();
        return;
      }
      if (!reviewReady()) {
        state.errors = ["四項複核都要勾選。"];
        render();
        return;
      }
      state.reached.pay = true;
      state.step = "pay";
      log("完成複核", state.review.note || "無備註");
      state.errors = [];
      render();
    });
    const backSources = document.getElementById("back-sources");
    if (backSources) backSources.addEventListener("click", function () { state.step = "sources"; render(); });
    const backDraft = document.getElementById("back-draft");
    if (backDraft) backDraft.addEventListener("click", function () { state.step = "draft"; render(); });

    const pay = document.getElementById("pay");
    if (pay) pay.addEventListener("click", simulatePay);
    const toSign = document.getElementById("to-sign");
    if (toSign) toSign.addEventListener("click", function () {
      state.step = "sign";
      state.reached.sign = true;
      render();
    });

    const canvas = document.getElementById("sign");
    if (canvas) bindCanvas(canvas);
    const clearSign = document.getElementById("clear-sign");
    if (clearSign) clearSign.addEventListener("click", function () {
      const box = document.getElementById("sign");
      if (box) box.getContext("2d").clearRect(0, 0, box.width, box.height);
    });
    const freeze = document.getElementById("freeze");
    if (freeze) freeze.addEventListener("click", freezeAndDownload);
    const again = document.getElementById("download-again");
    if (again) again.addEventListener("click", function () { downloadPdf(); });
    const backPay = document.getElementById("back-pay");
    if (backPay) backPay.addEventListener("click", function () { state.step = "pay"; render(); });
    const reset = document.getElementById("reset");
    if (reset) reset.addEventListener("click", function () { window.location.reload(); });
  }

  function validateParams() {
    const errors = [];
    if (!state.project.client.trim()) errors.push("請填委託人。");
    if (!state.project.place.trim()) errors.push("請填地點。");
    if (!state.project.use.trim()) errors.push("請填用途。");
    if (!state.project.engineer.trim()) errors.push("請填負責工程師。");
    if (!selectedTypes().length) errors.push("至少選一個類別：鋼樓梯、樓板開孔或鋼閣樓。");
    if (!state.deliverables.calc && !state.deliverables.drawings && !state.deliverables.report) errors.push("至少留一項交付。");
    if (state.basis.code === "custom" && !state.basis.codeCustom.trim()) errors.push("選了自填規範，請寫下版本。");
    if (!CHECKS.some(function (item) { return state.checks[item[0]]; })) errors.push("至少保留一項檢查。");
    return errors;
  }

  function fillSample() {
    state.project.client = "示範委託人（商業室內裝修）";
    state.project.place = "澳門半島";
    state.project.use = "商業餐飲裝修，局部改動";
    state.project.engineer = "負責工程師";
    state.types.A = true;
    state.types.B = true;
    state.types.C = false;
    state.basis.code = "provisional";
    state.basis.scheme = "新造鋼樓梯支承於既有梁，樓板局部擴孔，孔邊加鋼構。兩項共用既有支承。";
    state.basis.live = "4.0";
    state.basis.liveStatus = "假設";
    state.basis.dead = "1.5";
    state.basis.deadStatus = "假設";
    state.basis.support = "既有混凝土梁及樓板，截面與配筋未提供";
    state.basis.supportStatus = "未知";
    state.basis.stage = "先臨時支承，再切開樓板。臨時支承的能力未確認。";
    state.basis.stageStatus = "未知";
    state.basis.steel = "S355，尚無材料證明";
    state.basis.steelStatus = "假設";
    state.basis.concrete = "既有混凝土強度未知";
    state.basis.concreteStatus = "未知";
    state.basis.anchor = "圖內同時見到 M12 與 M20，不能當成已確認";
    state.basis.anchorStatus = "衝突";
    state.basis.geom.stairWidth = "1200";
    state.basis.geom.riser = "175";
    state.basis.geom.going = "250";
    state.basis.geom.landing = "1200 × 1200";
    state.basis.geom.opening = "1800 × 900";
    state.basis.geom.slabThickness = "";
    state.basis.geom.openingRelation = "開孔貼近既有梁，關係待圖則核對";
    markDirty();
    log("填入示範參數", "A+B 商業裝修");
    render();
  }

  function takeFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      const text = String(reader.result || "");
      const readable = text.indexOf("SECTION") !== -1 || /[\x20-\x7e\n\r\t]/.test(text.slice(0, 80));
      const messy = (text.match(/[^\x09\x0a\x0d\x20-\x7e]/g) || []).length > text.length * 0.2;
      state.sources.cad = {
        name: file.name,
        size: file.size,
        modified: file.lastModified,
        excerpt: !messy && readable ? text.slice(0, 1500) : "",
      };
      markDirty();
      log("登記圖則", file.name);
      render();
    };
    reader.readAsText(file);
  }

  function loadSampleFile() {
    fetch("/sample/macau-aa-sample.dxf").then(function (res) { return res.blob(); }).then(function (blob) {
      takeFile(new File([blob], "macau-aa-sample.dxf", { type: "application/dxf" }));
    }).catch(function () {
      state.errors = ["示範圖則載入失敗。"];
      render();
    });
  }

  function generateDraft() {
    if (state.agentRunning) return;
    state.errors = [];
    state.agentRunning = true;
    state.agentLines = [];
    const draft = buildDraft();
    render();
    let index = 0;
    const timer = setInterval(function () {
      state.agentLines.push(draft.lines[index]);
      index += 1;
      render();
      if (index >= draft.lines.length) {
        clearInterval(timer);
        state.agentRunning = false;
        state.draft = draft;
        state.draftStale = fingerprint() !== draft.fingerprint;
        state.payment = null;
        state.signature = null;
        state.frozen = null;
        state.pdfReady = false;
        state.review = { watermark: false, unchecked: false, gaps: false, anchor: false, note: "" };
        state.step = "draft";
        state.reached.draft = true;
        log("產生草稿", draft.id);
        render();
      }
    }, 160);
  }

  function simulatePay() {
    const payer = document.getElementById("payer").value.trim();
    const card = document.getElementById("card").value.replace(/\s+/g, "");
    const exp = document.getElementById("exp").value.trim();
    const cvc = document.getElementById("cvc").value.trim();
    const errors = [];
    if (!payer) errors.push("請填付款人。");
    if (!/^\d{12,19}$/.test(card)) errors.push("卡號請用 12 到 19 位數字。不會送出授權。");
    if (!/^\d{2}\/\d{2}$/.test(exp)) errors.push("到期請寫成 MM/YY。");
    if (!/^\d{3,4}$/.test(cvc)) errors.push("安全碼請用 3 或 4 位數字。");
    state.errors = errors;
    if (errors.length) { render(); return; }
    const button = document.getElementById("pay");
    button.disabled = true;
    button.textContent = "模擬處理中";
    setTimeout(function () {
      const stamp = new Date();
      const id = "PAY-" + stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate()) + "-" + String(Math.floor(1000 + Math.random() * 9000));
      state.payment = { id: id, payer: payer, at: stamp.toISOString(), amount: "MOP 1.00" };
      state.reached.sign = true;
      state.errors = [];
      log("模擬付款", id + " · 未送出交易");
      render();
    }, 500);
  }

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function bindCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1c1915";
    let drawing = false;
    function pos(event) {
      const rect = canvas.getBoundingClientRect();
      const source = event.touches ? event.touches[0] : event;
      return {
        x: (source.clientX - rect.left) * canvas.width / rect.width,
        y: (source.clientY - rect.top) * canvas.height / rect.height,
      };
    }
    function start(event) {
      drawing = true;
      const p = pos(event);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      event.preventDefault();
    }
    function move(event) {
      if (!drawing) return;
      const p = pos(event);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      event.preventDefault();
    }
    function end() { drawing = false; }
    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
  }

  function canvasUsed(canvas) {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return true;
    }
    return false;
  }

  function freezeAndDownload() {
    const name = document.getElementById("signer").value.trim();
    const canvas = document.getElementById("sign");
    const errors = [];
    if (!name) errors.push("請填簽署人。");
    if (!canvas || !canvasUsed(canvas)) errors.push("請在框裡留下筆跡。");
    if (!document.getElementById("ack-sign-1").checked || !document.getElementById("ack-sign-2").checked || !document.getElementById("ack-sign-3").checked) {
      errors.push("三項簽署聲明都要勾選。");
    }
    if (state.draftStale || !state.payment) errors.push("付款或草稿狀態不對，請回到前面的步驟。");
    state.errors = errors;
    if (errors.length) { render(); return; }
    state.signature = { name: name, at: new Date().toISOString(), dataUrl: canvas.toDataURL("image/png") };
    state.frozen = { id: state.draft.id + "-F", at: state.signature.at };
    state.pdfReady = true;
    log("本地簽署", name + " · " + state.frozen.id);
    render();
    downloadPdf();
  }

  function downloadPdf() {
    const sheet = document.getElementById("sheet");
    if (!sheet) return;
    const filename = state.project.number + "-" + (state.frozen ? state.frozen.id : "draft") + ".pdf";
    state.pdfName = filename;
    const html = sheet.outerHTML;
    const css = sheetCss();
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/pdf";
    form.acceptCharset = "UTF-8";
    [["html", html], ["css", css], ["filename", filename]].forEach(function (pair) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = pair[0];
      input.value = pair[1];
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
    log("下載 PDF", filename);
    renderSide();
  }

  function sheetCss() {
    return Array.prototype.map.call(document.styleSheets, function (sheet) {
      try {
        return Array.prototype.map.call(sheet.cssRules, function (rule) { return rule.cssText; }).join("\n");
      } catch (err) {
        return "";
      }
    }).join("\n");
  }

  function render() {
    renderSteps();
    renderMain();
    renderSide();
  }

  log("開啟原型", "空白項目 " + state.project.number);
  fetch("/api/health").then(function (res) { return res.json(); }).then(function (body) {
    state.chromeOk = Boolean(body.chrome);
    renderSide();
    if (!state.chromeOk && state.step === "sign") render();
  }).catch(function () { state.chromeOk = false; });
  render();
})();
