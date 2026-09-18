/*
  Drives deep-research.html for the article whose id comes from the URL
  (?id=...), recovered from sessionStorage on refresh via news-data.js —
  same resolution path article.html uses (window.EBNews.resolveCurrentId
  / getById), so no new data-passing convention is introduced.

  The HTML/CSS in deep-research.html (cards, tabs, stat grids, donut,
  accordion...) is untouched — this file only fills the small set of
  id-tagged slots added to that markup with content derived from the
  matched article's real fields (title, category, keywords, source,
  deepResearch.summary/keyPoints/impact/outlook/risks, term). Numeric
  metrics that don't exist in the data (growth %, market size, indicator
  values) are generated from a category "profile" plus a seed derived
  from the article's own id, so they read as plausible and are stable
  across reloads of the same article, but are not claimed as real
  figures — this is a portfolio prototype, not a live data feed.

  If no article resolves, this file does nothing and the page keeps
  showing its original static demo content (no separate not-found
  screen exists in this design, so none is added here).
*/
(function () {
  // ---------------------------------------------------------------------
  // Small seeded RNG (mulberry32) so a given article always generates the
  // same numbers on every load, instead of jittering on every refresh.
  // ---------------------------------------------------------------------
  function makeRng(seedStr) {
    var h = 1779033703 ^ seedStr.length;
    for (var i = 0; i < seedStr.length; i++) {
      h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    var seed = h >>> 0;
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function pickN(rng, arr, n) {
    var pool = arr.slice();
    var out = [];
    while (out.length < n && pool.length) {
      out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    }
    return out;
  }
  function intBetween(rng, min, max) { return Math.round(min + rng() * (max - min)); }
  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---------------------------------------------------------------------
  // Category profiles — the only per-category *fabricated* content
  // (metric names, indicator labels, donut/growth labels). These give the
  // stat cards a topic-appropriate vocabulary; the actual analysis text
  // (insights, accordion bodies, summary rows) always comes straight from
  // the article's own deepResearch fields, never from here.
  // ---------------------------------------------------------------------
  var PROFILES = {
    '반도체': {
      metrics: ['AI 서버 투자 증가율', 'HBM 시장 성장률', '파운드리 가동률', '첨단 패키징 수요', 'GPU 공급 증가율', '메모리 가격 반등폭'],
      sizeStats: [
        { label: 'AI 서버 시장 규모', min: 3000, max: 5000, unit: '억 달러' },
        { label: 'HBM 시장 규모', min: 300, max: 800, unit: '억 달러' }
      ],
      impactTitles: ['AI 반도체', '메모리 시장', '데이터센터', '전력 산업'],
      previewTitles: ['AI 투자 확대', '메모리 시장 성장', '공급망 영향'],
      indicatorLabels: ['AI 서버 투자 규모', 'HBM 시장 성장률', 'AI 반도체 시장 규모', '글로벌 데이터센터 투자', 'AI 서버 출하량', 'GPU 공급량', '첨단 패키징 수요', '전력 설비 투자'],
      donutTitle: 'AI 인프라<br />투자 구성',
      donutSectionTitle: 'AI 인프라 투자 구성 (2030 전망)',
      donutTotalLabel: '전체 AI 인프라 투자',
      donutLegend: ['AI 데이터센터', 'HBM 메모리', 'AI 서버', 'GPU'],
      growthLabels: ['HBM 시장', 'AI 서버', 'AI 반도체', '첨단 패키징'],
      detailTitles: ['AI 투자 확대 배경', 'HBM 시장 성장 전망', '국내 반도체 수혜 분석', 'AI가 주목한 변수']
    },
    '금리': {
      metrics: ['기준금리 동결 지속', '시중금리 변동폭', '가계대출 증가율', '예금금리 전망', '채권시장 변동성', '통화정책 기대지수'],
      sizeStats: [
        { label: '가계대출 잔액', min: 1800, max: 2000, unit: '조원' },
        { label: '채권시장 규모', min: 250, max: 400, unit: '조원' }
      ],
      impactTitles: ['통화정책', '채권시장', '가계대출', '금융시장'],
      previewTitles: ['금리 결정 배경', '금융시장 영향', '향후 정책 방향'],
      indicatorLabels: ['기준금리 수준', '가계대출 증가율', '채권시장 규모', '예금금리 평균', '시중은행 대출금리', '가계부채 비율', '통화정책 기대지수', '금융시장 변동성'],
      donutTitle: '금리 정책<br />영향 구성',
      donutSectionTitle: '금리 정책 영향 구성 (전망)',
      donutTotalLabel: '전체 금융시장 영향',
      donutLegend: ['가계대출 영향', '기업대출 영향', '채권시장 영향', '예금금리 영향'],
      growthLabels: ['가계대출', '채권금리', '예금금리', '기업대출'],
      detailTitles: ['금리 결정 배경', '가계·기업 대출 영향', '채권·금융시장 반응', '향후 통화정책 변수']
    },
    '부동산': {
      metrics: ['서울 아파트값 변동률', '재건축 단지 상승폭', '전세가율 변동', '거래량 증가율', '매매수급지수', '청약 경쟁률'],
      sizeStats: [
        { label: '서울 아파트 거래량', min: 3000, max: 8000, unit: '건' },
        { label: '재건축 사업 규모', min: 50, max: 150, unit: '조원' }
      ],
      impactTitles: ['매매시장', '전세시장', '재건축', '대출규제'],
      previewTitles: ['가격 상승 배경', '거래시장 영향', '정책 변수'],
      indicatorLabels: ['서울 아파트값 상승률', '재건축 단지 상승폭', '전세가율', '거래량 증가율', '매매수급지수', '청약 경쟁률', '대출규제 강도', '지방 부동산 전망'],
      donutTitle: '부동산 시장<br />영향 구성',
      donutSectionTitle: '부동산 시장 영향 구성',
      donutTotalLabel: '전체 시장 영향',
      donutLegend: ['강남권 영향', '재건축 영향', '전세시장 영향', '대출규제 영향'],
      growthLabels: ['강남권', '재건축', '전세가율', '거래량'],
      detailTitles: ['가격 상승 배경', '재건축·거래시장 영향', '전세시장 반응', '대출규제 등 향후 변수']
    },
    '환율': {
      metrics: ['원달러 환율 변동폭', '수입물가 상승률', '수출기업 채산성', '외국인 순매수 규모', '원화 변동성 지수', '무역수지 영향도'],
      sizeStats: [
        { label: '외환보유액', min: 4000, max: 4500, unit: '억 달러' },
        { label: '월간 무역수지', min: 30, max: 90, unit: '억 달러' }
      ],
      impactTitles: ['수출기업', '수입물가', '외환시장', '증시자금'],
      previewTitles: ['환율 변동 배경', '수출입 영향', '외환시장 전망'],
      indicatorLabels: ['원달러 환율 수준', '수입물가 상승률', '수출기업 채산성', '외국인 순매수 규모', '외환보유액', '무역수지', '원화 변동성', '수출 증가율'],
      donutTitle: '환율 변동<br />영향 구성',
      donutSectionTitle: '환율 변동 영향 구성',
      donutTotalLabel: '전체 무역 영향',
      donutLegend: ['수출기업 영향', '수입물가 영향', '외국인자금 영향', '기업채산성 영향'],
      growthLabels: ['수출채산성', '수입물가', '외국인자금', '원화가치'],
      detailTitles: ['환율 변동 배경', '수출입 기업 영향', '외환·증시자금 반응', '향후 변수']
    },
    '증시': {
      metrics: ['코스피 상승률', '외국인 순매수 규모', '거래대금 증가율', '시가총액 증가율', '변동성 지수', '기관 순매수 비중'],
      sizeStats: [
        { label: '코스피 시가총액', min: 2000, max: 2600, unit: '조원' },
        { label: '일평균 거래대금', min: 10, max: 25, unit: '조원' }
      ],
      impactTitles: ['코스피', '업종별 수급', '외국인자금', '거래대금'],
      previewTitles: ['상승 배경', '업종별 영향', '수급 전망'],
      indicatorLabels: ['코스피 상승률', '외국인 순매수 규모', '거래대금 증가율', '시가총액 증가율', '반도체 업종 기여도', '기관 순매수 비중', '변동성 지수', '개인 순매수 비중'],
      donutTitle: '증시 상승<br />기여 구성',
      donutSectionTitle: '증시 상승 기여 구성',
      donutTotalLabel: '전체 시가총액 증가',
      donutLegend: ['반도체 업종', '이차전지 업종', '금융 업종', '기타 업종'],
      growthLabels: ['반도체업종', '이차전지업종', '금융업종', '기타업종'],
      detailTitles: ['상승 배경', '업종별 수급 영향', '외국인·기관 자금 반응', '향후 변수']
    },
    '물가': {
      metrics: ['소비자물가 상승률', '외식물가 상승률', '근원물가 변동', '체감물가 지수', '생활물가 부담도', '에너지물가 기여도'],
      sizeStats: [
        { label: '월평균 외식물가', min: 3, max: 8, unit: '만원' },
        { label: '가계 소비지출', min: 250, max: 320, unit: '만원' }
      ],
      impactTitles: ['소비자물가', '외식물가', '생활물가', '통화정책'],
      previewTitles: ['물가 상승 배경', '가계 부담 영향', '향후 물가 전망'],
      indicatorLabels: ['소비자물가 상승률', '외식물가 상승률', '근원물가 변동', '체감물가 지수', '생활물가 부담도', '에너지물가 기여도', '신선식품 물가', '물가안정 목표 괴리도'],
      donutTitle: '물가 상승<br />요인 구성',
      donutSectionTitle: '물가 상승 요인 구성',
      donutTotalLabel: '전체 물가 부담',
      donutLegend: ['외식물가 영향', '에너지물가 영향', '생활물가 영향', '기타 요인'],
      growthLabels: ['외식물가', '에너지물가', '생활물가', '신선식품'],
      detailTitles: ['물가 상승 배경', '가계 체감 부담', '통화정책·정책 대응', '향후 물가 변수']
    },
    '고용': {
      metrics: ['청년 체감실업률', '신규 취업자 증가율', '고용률 변동', '구직 활동 증가율', '실업급여 신청 증가율', '고용시장 심리지수'],
      sizeStats: [
        { label: '신규 취업자 수', min: 10, max: 40, unit: '만명' },
        { label: '청년 구직자 수', min: 50, max: 90, unit: '만명' }
      ],
      impactTitles: ['청년고용', '산업별 고용', '고용정책', '노동시장'],
      previewTitles: ['고용시장 배경', '산업별 영향', '정책 대응 전망'],
      indicatorLabels: ['청년 체감실업률', '신규 취업자 증가율', '고용률', '구직 활동 증가율', '실업급여 신청 증가율', '정규직 전환율', '제조업 고용', '서비스업 고용'],
      donutTitle: '고용시장<br />영향 구성',
      donutSectionTitle: '고용시장 영향 구성',
      donutTotalLabel: '전체 고용시장 영향',
      donutLegend: ['청년층 영향', '제조업 영향', '서비스업 영향', '기타 영향'],
      growthLabels: ['청년고용', '제조업', '서비스업', '정규직전환'],
      detailTitles: ['고용시장 배경', '산업별 고용 영향', '청년·노동시장 반응', '향후 정책 변수']
    },
    '에너지': {
      metrics: ['국제유가 변동폭', '전기요금 인상률', '에너지수입 비용', '가계 에너지비 부담', '산업용 전력수요', '신재생에너지 비중'],
      sizeStats: [
        { label: '월평균 에너지 수입액', min: 80, max: 150, unit: '억 달러' },
        { label: '가구당 에너지비', min: 15, max: 30, unit: '만원' }
      ],
      impactTitles: ['전기요금', '산업 에너지비', '가계 부담', '에너지정책'],
      previewTitles: ['가격 변동 배경', '가계·산업 영향', '에너지정책 전망'],
      indicatorLabels: ['국제유가 수준', '전기요금 인상률', '에너지수입 비용', '가계 에너지비 부담', '산업용 전력수요', '신재생에너지 비중', '원자재가 변동성', '에너지 자립도'],
      donutTitle: '에너지 비용<br />영향 구성',
      donutSectionTitle: '에너지 비용 영향 구성',
      donutTotalLabel: '전체 에너지 비용 영향',
      donutLegend: ['가계 부담 영향', '산업용 영향', '수입비용 영향', '정책 영향'],
      growthLabels: ['가계에너지비', '산업용전력', '수입비용', '신재생비중'],
      detailTitles: ['가격 변동 배경', '가계·산업 부담 영향', '에너지정책 대응', '향후 변수']
    },
    'ETF': {
      metrics: ['ETF 자금 유입 규모', '개인투자자 비중', '테마 ETF 수익률', '거래대금 증가율', '순자산 증가율', 'ETF 시장 성장률'],
      sizeStats: [
        { label: 'ETF 순자산 총액', min: 100, max: 180, unit: '조원' },
        { label: '월간 자금 유입액', min: 1, max: 3, unit: '조원' }
      ],
      impactTitles: ['자금유입', '개인투자', '테마수익률', '시장규모'],
      previewTitles: ['자금 유입 배경', '투자자 동향', '테마별 영향'],
      indicatorLabels: ['ETF 자금 유입 규모', '개인투자자 비중', '테마 ETF 수익률', '거래대금 증가율', '순자산 증가율', '해외 ETF 비중', 'ETF 시장 성장률', '업종 ETF 편차'],
      donutTitle: 'ETF 자금<br />구성',
      donutSectionTitle: 'ETF 자금 구성',
      donutTotalLabel: '전체 ETF 순자산',
      donutLegend: ['국내주식형', '해외주식형', '채권형', '테마형'],
      growthLabels: ['국내주식형', '해외주식형', '채권형', '테마형'],
      detailTitles: ['자금 유입 배경', '개인투자자 동향', '테마별 수익률 분석', '향후 시장 변수']
    }
  };
  var ALIAS = { '주거': '부동산', '가계부채': '금리', '글로벌경제': '금리', '글로벌증시': '증시' };
  function getProfile(category) {
    return PROFILES[category] || PROFILES[ALIAS[category]] || PROFILES['증시'];
  }

  var WORD_VALUES = ['증가세', '확대세', '강세', '개선세'];
  var WORD_OUTLOOKS = ['긍정 전망', '수혜 기대', '호조 전망', '안정 전망'];
  var IC_STATUSES = ['상승 기대', '수요 증가', '투자 확대', '수혜 기대', '개선 흐름'];
  var IC_BADGES_POS = '긍정적';
  var INDICATOR_BADGES = ['성장', '확대', '증가'];

  // Negative/downside counterparts — every report should surface at least a
  // couple of these instead of reading as uniformly bullish. Colors for
  // these use the design system's status2-red token pair (colors.css).
  var IC_STATUSES_NEG = ['하락 우려', '수요 감소', '투자 위축', '부담 증가', '둔화 흐름'];
  var IC_BADGE_NEG = '부정적';
  var INDICATOR_BADGES_NEG = ['하락', '위축', '감소'];

  function titleBreak(title) {
    var idx = title.indexOf(', ');
    if (idx === -1) return escapeHtml(title);
    return escapeHtml(title.slice(0, idx)) + ',<br />' + escapeHtml(title.slice(idx + 2));
  }

  function formatDuration(rng) {
    var minutes = 1 + Math.floor(rng() * 3);
    var seconds = Math.floor(rng() * 60);
    return minutes + '분 ' + String(seconds).padStart(2, '0') + '초';
  }
  function formatNow() {
    var d = new Date();
    return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0') +
      ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function statCardHtml(label, value, sub, sparkVariant) {
    return '<div class="stat-card"><div class="sc-label">' + escapeHtml(label) + '</div><div class="sc-value lg">' + escapeHtml(value) +
      '</div><div class="sc-sub">' + escapeHtml(sub) + '</div><img class="sc-spark" src="assets/img/icons/sparkline-' + sparkVariant + '.svg" alt="" /></div>';
  }

  function renderHeader(article, rng) {
    var loadingTitle = document.getElementById('loading-title');
    if (loadingTitle) loadingTitle.textContent = article.title + '은 ' + article.category + ' 시장에 어떤 영향을 미칠까요?';
    var loadingTags = document.getElementById('loading-tags');
    if (loadingTags) {
      var tags = (article.keywords || []).slice(0, 3);
      while (tags.length < 3) tags.push(article.category);
      loadingTags.innerHTML = tags.map(function (t) { return '<span>' + escapeHtml(t) + '</span>'; }).join('');
    }
    var reportTitle = document.getElementById('report-title');
    if (reportTitle) reportTitle.innerHTML = titleBreak(article.title);
    var reportMeta = document.getElementById('report-meta');
    if (reportMeta) {
      reportMeta.innerHTML = '완료 시간 ' + formatNow() + '&nbsp;&nbsp;|&nbsp;&nbsp;분석 시간 ' + formatDuration(rng);
    }
    document.title = '이코노미브리프 - 딥 리서치 - ' + article.title;
  }

  function renderPreviewPoints(article, profile) {
    var el = document.getElementById('preview-points');
    if (!el) return;
    var kp = (article.deepResearch && article.deepResearch.keyPoints) || [];
    var icons = [
      { bg: '#F1F1F1', color: '#5F738C', gicon: 'lightbulb' },
      { bg: '#ECF8F1', color: '#4B8C6B', gicon: 'trending_up' },
      { bg: '#DDE1FF', color: '#591BAF', gicon: 'query_stats' }
    ];
    var titles = profile.previewTitles;
    el.innerHTML = titles.map(function (title, i) {
      var ic = icons[i];
      var titleColor = i === 0 ? '' : ' style="color:' + ic.color + ';"';
      return '<div class="preview-point"' + (i > 0 ? ' style="background:#FAFBFE;"' : '') + '>' +
        '<div class="pp-icon" style="background:' + ic.bg + ';"><span class="gicon" style="color:' + ic.color + ';" role="img" aria-label="">' + ic.gicon + '</span></div>' +
        '<div class="pp-text"><p' + titleColor + '>' + escapeHtml(title) + '</p><p>' + escapeHtml(kp[i] || article.description || '') + '</p></div>' +
        '</div>';
    }).join('');
  }

  // Collapses a redundant Korean "reportative hedge" wrapper (e.g. "~다는
  // 것으로 전해진다/나타났다/알려졌다/보인다/분석된다/평가된다/풀이된다/
  // 관측된다") back down to the plain "-다." ending that's already fully
  // present earlier in the same clause. This is a genuine rule-based
  // rewrite - the compressed sentence is no longer a literal substring of
  // the original text - not a substring/first-sentence extraction, and it
  // never invents a fact, since the verb form it keeps was already there.
  function compressReportedClause(sentence) {
    return String(sentence || '').replace(
      /다는\s*것으로\s*(나타났다|전해진다|전해졌다|알려졌다|보인다|분석된다|평가된다|풀이된다|관측된다|파악됐다|파악된다|점쳐진다|기대된다)\.?/g,
      '다.'
    ).trim();
  }

  // Strips a leading date(+time, or +"(현지시간)"+city) opener that carries
  // no real information beyond "when/where this was filed" - e.g. "18일
  // 오전 9시 4분쯤 ", "17일(현지시간) 런던 ". Only matches at the very
  // START of the sentence, right before a day-of-month "일" marker, so a
  // real fact stated elsewhere in the sentence (a price, a percentage, an
  // actual reported date) is never touched.
  function stripLeadingDateTimeOpener(sentence) {
    var s = String(sentence || '');
    s = s.replace(/^\d{1,2}일\s*\((현지시간|현지시각)\)\s*[가-힣A-Za-z]{0,10}\s*/, '');
    s = s.replace(/^\d{1,2}일\s*(오전|오후)?\s*(\d{1,2}시)?\s*(\d{1,2}분)?\s*(쯤)?\s*/, '');
    return s.trim();
  }

  // Drops a literal word-for-word prefix the sentence shares with the
  // article's own title (e.g. title "S&P500 선물, 연준 금리 인상..." and a
  // description sentence both starting with "S&P500 선물") - word-boundary
  // safe, exact match only (trailing punctuation ignored, so "선물," vs
  // "선물" still counts as the same word) - never rewrites, only removes
  // words already shown to the user in the headline above.
  function stripTitleOverlapPrefix(sentence, title) {
    function normalizeWord(w) { return String(w || '').replace(/[,.!?·…]+$/, ''); }
    var titleWords = String(title || '').trim().split(/\s+/).map(normalizeWord).filter(Boolean);
    var words = String(sentence || '').trim().split(/\s+/);
    var i = 0;
    while (i < titleWords.length && i < words.length && normalizeWord(words[i]) === titleWords[i]) i++;
    if (i === 0) return sentence;
    return words.slice(i).join(' ').trim();
  }

  // Never cuts mid-word/mid-clause: only ever shortens by dropping whole
  // leading comma-separated clauses (keeping the final clause, which
  // carries the sentence's own closing verb/ending) until it fits the
  // target length, or there's nothing left to drop (in which case the full
  // sentence is kept - a length target is best-effort, never a hard cut).
  function shortenByDroppingLeadingClauses(sentence, maxLen) {
    var s = String(sentence || '');
    while (s.length > maxLen) {
      var idx = s.indexOf(',');
      if (idx === -1) break;
      var rest = s.slice(idx + 1).trim();
      if (!rest) break;
      s = rest;
    }
    return s;
  }

  var CORE_SUMMARY_TARGET_LEN = 70;

  // Combines the cleanup steps above into one pipeline: hedge-compression,
  // then date/time-opener stripping, then title-overlap stripping, then
  // (only if still long) comma-clause shortening toward CORE_SUMMARY_TARGET_LEN.
  // A sentence that's already short and clean is returned unchanged.
  function refineCoreSentence(sentence, title) {
    var s = compressReportedClause(sentence);
    // Title-overlap words are stripped BEFORE the date/time-opener check -
    // a sentence like "S&P500 선물 18일 오전 ..." only exposes its leading
    // "18일 오전" date opener once the title-shared "S&P500 선물" prefix in
    // front of it has already been removed.
    s = stripTitleOverlapPrefix(s, title).trim();
    s = stripLeadingDateTimeOpener(s);
    if (s.length > CORE_SUMMARY_TARGET_LEN) {
      s = shortenByDroppingLeadingClauses(s, CORE_SUMMARY_TARGET_LEN);
    }
    return s;
  }

  // Builds the "핵심 요약" row's headline/detail pair for a REAL live
  // article (never for a hand-authored one - see the whatHappened check in
  // renderCoreTab below, which keeps those untouched).
  //
  // Prefers the article's own real Gemini-generated summary when one
  // already exists (article.summaryStatus === 'generated') - the exact
  // same "AI 핵심 요약" already shown on article.html, not a new LLM call -
  // since that is an actual synthesized summary, never a raw extraction,
  // and already satisfies every rule here (no title echo, no verbatim
  // description copy, no filler, per-article distinct). Only when Gemini
  // hasn't produced one yet (not_requested/skipped/invalid/failed) does
  // this fall back to a rule-based compression of the description's own
  // real sentence(s) - still never the raw title, and never an untouched
  // copy of the first sentence.
  function buildCoreSummaryHeadline(article) {
    var geminiBullets = (article.summaryStatus === 'generated' && Array.isArray(article.aiSummary) && article.aiSummary.length)
      ? article.aiSummary : null;
    if (geminiBullets) {
      var detail1 = (geminiBullets[1] && geminiBullets[1] !== geminiBullets[0]) ? geminiBullets[1] : '';
      return { headline: geminiBullets[0], detail: detail1 };
    }
    // news-data.js (loaded before this file - see deep-research.html's
    // script order) already strips source tags/screen numbers/bylines/
    // broadcast time markers/"..."/"…" for exactly this purpose - reused
    // here instead of a third copy of the same regex set.
    var rawDesc = (window.EBNews && window.EBNews.sanitizeDescriptionForSummary)
      ? window.EBNews.sanitizeDescriptionForSummary(article.description)
      : article.description;
    var desc = String(rawDesc || '').trim();
    if (!desc || (article.source && desc === article.source + ' 보도') || desc.length < 20) {
      return { headline: article.title, detail: '' };
    }
    // The [.!?]+ only counts as a sentence boundary when followed by
    // whitespace/end-of-string (same pattern news-data.js's splitSentences()
    // uses), but that alone isn't enough: a decimal point in a real number
    // like "1.25%" has no real terminator anywhere else in the whole
    // remaining text, so the "[^.!?]+$" fallback branch (for a trailing
    // fragment with no terminator) still treated the LAST decimal point as
    // its own boundary and threw away everything before it (real bug hit
    // QA-testing a live 금리 article: "18일 기준금리를 연 1.0%에서
    // 1.25%로" produced the headline "25 특히 최근..." - starting mid-number).
    // Decimal points are protected (swapped for a placeholder no regex
    // branch here treats as a boundary) before splitting, then restored.
    var protectedDesc = desc.replace(/(\d)\.(\d)/g, '$1__DP__$2');
    var sentences = (protectedDesc.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [protectedDesc])
      .map(function (s) { return s.split('__DP__').join('.').trim(); })
      .filter(Boolean)
      .map(function (s) { return refineCoreSentence(s, article.title); })
      .filter(function (s) { return s && s.length >= 8; });
    var headline = sentences[0] || article.title;
    var detail = (sentences[1] && sentences[1] !== headline) ? sentences[1] : '';
    return { headline: headline, detail: detail };
  }

  function renderCoreTab(article, profile, rng) {
    var dr = article.deepResearch || {};
    var kp = dr.keyPoints || [];

    var rows = document.getElementById('core-summary-rows');
    if (rows) {
      var headline, detail;
      if (article.whatHappened) {
        // Hand-authored article (data/news.json) - deepResearch.keyPoints[0]
        // is a real person-curated headline, distinct from the description
        // by construction - never regenerate it, and the full description
        // underneath is real elaboration, not a repeat (unchanged from
        // before this turn's fix).
        headline = kp[0] || article.title;
        detail = article.description || '';
      } else {
        var core = buildCoreSummaryHeadline(article);
        headline = core.headline;
        detail = core.detail;
      }
      var titles = [headline, kp[1] || article.title, kp[2] || article.title];
      var descs = [detail, dr.impact, dr.outlook];
      rows.innerHTML = [0, 1, 2].map(function (i) {
        var body = descs[i] || '';
        return '<div class="numbered-row"><div class="num-avatar"><img src="assets/img/' + (i + 1) + '.png" alt="" /></div>' +
          '<div class="num-text"><p>' + escapeHtml(titles[i]) + '</p>' +
          (body ? '<p>' + escapeHtml(body) + '</p>' : '') + '</div></div>';
      }).join('');
    }

    var statGrid = document.getElementById('core-stat-grid');
    if (statGrid) {
      var m = pickN(rng, profile.metrics, 4);
      statGrid.innerHTML =
        statCardHtml(m[0], intBetween(rng, 12, 35) + '%', '전년 대비', '1') +
        statCardHtml(m[1], '+' + intBetween(rng, 20, 45) + '%', '연평균 전망', '1') +
        statCardHtml(m[2], pick(rng, WORD_VALUES), '시장 전망', '1') +
        statCardHtml(m[3], pick(rng, WORD_OUTLOOKS), '실적 기대', '1');
    }

    var insight = document.getElementById('core-insight-text');
    if (insight) insight.textContent = dr.impact || '';

    var sizeGrid = document.getElementById('core-size-grid');
    if (sizeGrid) {
      sizeGrid.innerHTML = profile.sizeStats.map(function (s, i) {
        var val = intBetween(rng, s.min, s.max).toLocaleString('ko-KR') + s.unit;
        return statCardHtml(s.label, val, '2030년 전망', String(i + 1));
      }).join('');
    }
  }

  function renderMarketTab(article, profile, rng) {
    var dr = article.deepResearch || {};
    var kp = dr.keyPoints || [];

    var grid = document.getElementById('market-impact-grid');
    if (grid) {
      // Exactly one of the first 3 cards reads as a downside signal, so the
      // tab doesn't look uniformly bullish — index 3 keeps its existing
      // "주의" caution badge untouched.
      var impactNegIdx = Math.floor(rng() * 3);
      grid.innerHTML = profile.impactTitles.map(function (title, i) {
        var negative = i === impactNegIdx;
        var badge = negative ? '<div class="ic-badge red">' + IC_BADGE_NEG + '</div>' :
          (i === 3 ? '<div class="ic-badge green">주의</div>' : '<div class="ic-badge">' + IC_BADGES_POS + '</div>');
        var iconBg = negative ? 'var(--color-status2-red-bg)' : 'var(--color-status2-green-bg)';
        var iconName = negative ? 'trending_down' : 'trending_up';
        var status = negative ? pick(rng, IC_STATUSES_NEG) : pick(rng, IC_STATUSES);
        return '<div class="impact-card' + (negative ? ' negative' : '') + '"><div class="ic-head"><span class="gicon" style="background:' + iconBg + ';border-radius:10px;padding:3px;box-sizing:border-box;" role="img" aria-label="">' + iconName + '</span><span>' +
          escapeHtml(title) + '</span></div><div><div class="ic-title">' + escapeHtml(status) + '</div><div class="ic-desc">' +
          escapeHtml(kp[i % kp.length] || article.category) + '</div></div>' + badge + '</div>';
      }).join('');
    }

    var insight1 = document.getElementById('market-insight-text');
    if (insight1) insight1.textContent = dr.outlook || '';

    var detailList = document.getElementById('market-detail-list');
    if (detailList) {
      var bodies = [dr.summary, dr.impact, dr.outlook, dr.risks];
      var itemsHtml = profile.detailTitles.map(function (title, i) {
        var sentence = bodies[i] || '';
        var bullets = sentence.split(/(?<=[.!?다요]\s)|(?<=,\s)/).filter(Boolean).slice(0, 2);
        if (!bullets.length) bullets = [sentence];
        return '<div class="detail-item"><div class="di-head"><div class="di-num">0' + (i + 1) + '</div><div class="di-title">' +
          escapeHtml(title) + '</div><span class="gicon chev" role="img" aria-label="">keyboard_arrow_down</span></div><div class="di-body"><ul>' +
          bullets.map(function (b) { return '<li>' + escapeHtml(b.trim()) + '</li>'; }).join('') + '</ul></div></div>';
      }).join('');
      // keep the existing section-title-row (h3 + "더 보기"), replace only the item list after it
      var titleRow = detailList.querySelector('.section-title-row');
      detailList.innerHTML = '';
      if (titleRow) detailList.appendChild(titleRow);
      detailList.insertAdjacentHTML('beforeend', itemsHtml);
      wireAccordion(detailList);
    }

    var growthGrid = document.getElementById('market-growth-grid');
    if (growthGrid) {
      var g = pickN(rng, profile.metrics, 2);
      var pct1 = intBetween(rng, 15, 35);
      growthGrid.innerHTML =
        '<div class="stat-card"><div class="sc-label">' + escapeHtml(g[0]) + '</div><div class="sc-value-row"><div class="sc-value lg">' + pct1 +
        '%</div><div class="sc-delta up"><span class="gicon" role="img" aria-label="">arrow_drop_up</span><span>' + (rng() * 0.9 + 0.1).toFixed(1) +
        '%p</span></div></div><div class="sc-sub">전년 대비</div><img class="sc-spark" src="assets/img/icons/sparkline-1.svg" alt="" /></div>' +
        statCardHtml(g[1], '연평균 ' + intBetween(rng, 20, 40) + '%', '시장 전망', '2');
    }

    var insight2 = document.getElementById('market-insight2-text');
    if (insight2) insight2.textContent = dr.summary || '';
  }

  function renderDetailTab(article, profile) {
    var dr = article.deepResearch || {};
    var bodies = [
      { desc: article.whatHappened || dr.summary, box: dr.keyPoints || [], mini: dr.impact },
      { desc: dr.impact, box: (dr.keyPoints || []).slice(0, 3), mini: dr.outlook },
      { desc: dr.outlook, box: (dr.keyPoints || []).slice().reverse(), mini: dr.summary },
      { desc: dr.risks || dr.outlook, box: dr.keyPoints || [], mini: dr.risks }
    ];
    var list = document.getElementById('detail-accordion-list');
    if (list) {
      var titleRow = list.querySelector('.section-title-row');
      var itemsHtml = profile.detailTitles.map(function (title, i) {
        var b = bodies[i];
        return '<div class="detail-item' + (i === 0 ? ' expanded' : '') + '"' + (i === 0 ? ' style="border-top:none;"' : '') + '>' +
          '<div class="di-head"><div class="di-num">0' + (i + 1) + '</div><div class="di-title">' + escapeHtml(title) +
          '</div><span class="gicon chev" role="img" aria-label="">keyboard_arrow_' + (i === 0 ? 'up' : 'down') + '</span></div>' +
          '<div class="di-body"><p class="di-desc">' + escapeHtml(b.desc || '') + '</p>' +
          '<div class="di-box"><p class="box-title">주요 영향 요인</p><ul>' +
          b.box.map(function (t) { return '<li>' + escapeHtml(t) + '</li>'; }).join('') + '</ul></div>' +
          '<div class="di-mini-insight"><div class="ai-badge">AI</div><div><div class="title">핵심 분석</div><p>' +
          escapeHtml(b.mini || '') + '</p></div></div></div></div>';
      }).join('');
      list.innerHTML = '';
      if (titleRow) list.appendChild(titleRow);
      list.insertAdjacentHTML('beforeend', itemsHtml);
      wireAccordion(list);
    }
    var summary = document.getElementById('detail-summary-text');
    if (summary) summary.textContent = dr.summary || '';
  }

  function renderRelatedTab(article, profile, rng) {
    var grid = document.getElementById('related-indicator-grid');
    if (grid) {
      // Exactly one indicator reads negative — always as a percentage change
      // (an absolute market-size figure can't sensibly go "negative").
      var indicatorNegIdx = Math.floor(rng() * profile.indicatorLabels.length);
      grid.innerHTML = profile.indicatorLabels.map(function (label, i) {
        var negative = i === indicatorNegIdx;
        var isPct = negative ? true : rng() > 0.4;
        var value = isPct ? (negative ? '-' : '') + intBetween(rng, 15, 40) + '%' : intBetween(rng, 500, 5000).toLocaleString('ko-KR') + '억 달러';
        var iconBg = negative ? 'var(--color-status2-red-bg)' : 'var(--color-status2-green-bg)';
        var iconName = negative ? 'trending_down' : 'trending_up';
        var badge = negative ? '<div class="ic-badge red">' + pick(rng, INDICATOR_BADGES_NEG) + '</div>' : '<div class="ic-badge green">' + pick(rng, INDICATOR_BADGES) + '</div>';
        return '<div class="impact-card' + (negative ? ' negative' : '') + '"><div class="ic-head"><span class="gicon" style="background:' + iconBg + ';border-radius:10px;padding:3px;box-sizing:border-box;" role="img" aria-label="">' + iconName + '</span><span>' +
          escapeHtml(label) + '</span></div><div><div class="ic-title">' + value + '</div><div class="ic-desc">' +
          (isPct ? '전년 대비' : '2030년 전망') + '</div></div>' + badge + '</div>';
      }).join('');
    }

    var donutTitleEl = document.getElementById('related-donut-title');
    if (donutTitleEl) donutTitleEl.innerHTML = profile.donutTitle;
    var donutSectionTitleEl = document.getElementById('related-donut-section-title');
    if (donutSectionTitleEl) donutSectionTitleEl.textContent = profile.donutSectionTitle;

    var legendEl = document.getElementById('related-donut-legend');
    if (legendEl) {
      var shares = [38, 14, 29, 13].sort(function () { return rng() - 0.5; });
      legendEl.innerHTML = profile.donutLegend.map(function (label, i) {
        return '<div class="legend-row"><div class="l-left"><img src="assets/img/icons/legend-dot-' + (i + 1) + '.svg" alt="" /><span>' +
          escapeHtml(label) + '</span></div><span>' + shares[i] + '%</span></div>';
      }).join('');
    }
    var totalLabelEl = document.getElementById('related-donut-total-label');
    if (totalLabelEl) totalLabelEl.textContent = profile.donutTotalLabel;
    var totalValueEl = document.getElementById('related-donut-total-value');
    if (totalValueEl) totalValueEl.textContent = intBetween(rng, 2000, 5000).toLocaleString('ko-KR') + '억 달러';

    var growthList = document.getElementById('related-growth-list');
    if (growthList) {
      growthList.innerHTML = profile.growthLabels.map(function (label) {
        var pct = intBetween(rng, 8, 65);
        return '<div class="growth-row"><div class="g-label">' + escapeHtml(label) + '</div><div class="g-bar-wrap"><div class="g-track"><div class="g-fill" style="width:' +
          Math.min(pct, 100) + '%;"></div></div><div class="g-pct">+' + pct + '%</div></div></div>';
      }).join('');
    }

    var insightList = document.getElementById('related-insight-list');
    if (insightList) {
      var dr = article.deepResearch || {};
      var lines = [dr.impact, dr.outlook, dr.risks].filter(Boolean);
      insightList.innerHTML = lines.map(function (l) { return '<li>' + escapeHtml(l) + '</li>'; }).join('');
    }
  }

  function renderSourcesTab(article, allArticles, profile) {
    var related = (allArticles || []).filter(function (a) {
      return a.id !== article.id && a.category === article.category;
    }).slice(0, 3);

    var banner = document.getElementById('source-banner-text');
    var total = 1 + related.length + 2;
    if (banner) banner.textContent = 'AI가 신뢰할 수 있는 ' + total + '개의 출처를 분석해 리포트를 작성했습니다. 최신성과 신뢰도, 질문과의 연관성을 기준으로 자료를 선별했습니다.';
    var countTitle = document.getElementById('source-count-title');
    if (countTitle) countTitle.textContent = '주요 분석 출처 (' + total + ')';
    var pills = document.getElementById('source-filter-pills');
    if (pills) {
      var buttons = pills.querySelectorAll('button');
      if (buttons[0]) buttons[0].textContent = '전체(' + total + ')';
      if (buttons[1]) buttons[1].textContent = '뉴스/기사(' + (1 + related.length) + ')';
      if (buttons[2]) buttons[2].textContent = '공식보고서(1)';
      if (buttons[3]) buttons[3].textContent = '산업리포트 (1)';
    }

    var list = document.querySelector('.source-list');
    if (!list) return;
    var items = [];
    // 1) the article's own original source — real link back to article.html
    items.push({
      title: article.title,
      desc: article.description,
      badge: '원문 기사',
      meta: escapeHtml(article.source) + ' · ' + escapeHtml(window.EBNews.formatDate(article.date)),
      href: 'article.html?id=' + encodeURIComponent(article.id),
      logo: article.sourceLogo
    });
    // 2) other real articles in the same category — real links too
    related.forEach(function (a) {
      items.push({
        title: a.title,
        desc: a.description,
        badge: '뉴스/기사',
        meta: escapeHtml(a.source) + ' · ' + escapeHtml(window.EBNews.formatDate(a.date)),
        href: 'article.html?id=' + encodeURIComponent(a.id),
        logo: a.sourceLogo
      });
    });
    // 3) portfolio-style filler entries (no real external URL exists) — not clickable
    items.push({ title: profile.donutSectionTitle + ' 관련 산업 리포트', desc: article.category + ' 시장 동향을 종합 정리한 자료입니다.', badge: '산업리포트', meta: '이코노미브리프 리서치팀' });
    items.push({ title: article.category + ' 정책·통계 공식 자료', desc: '관계기관이 발표한 공식 통계와 정책 자료입니다.', badge: '공식보고서', meta: '공공데이터포털' });

    list.innerHTML = items.map(function (it, i) {
      var clickable = !!it.href;
      var tag = clickable ? 'button' : 'div';
      var attrs = clickable ? ' type="button" data-href="' + it.href + '"' : '';
      var moreCls = i >= 4 ? ' more-item' : '';
      var logoImg = it.logo ? '<img src="' + it.logo + '" alt="" />' : '<span class="gicon" style="font-size:14px;" role="img" aria-label="">description</span>';
      return '<' + tag + ' class="source-item' + moreCls + '"' + attrs + (clickable ? ' style="cursor:pointer;width:100%;text-align:left;border:none;background:none;font-family:inherit;"' : '') + '>' +
        '<div class="src-logo">' + logoImg + '</div>' +
        '<div class="src-body"><div class="src-title-row"><span class="src-title">' + escapeHtml(it.title) + '</span><span class="src-badge">' + it.badge + '</span></div>' +
        '<div class="src-desc">' + escapeHtml(it.desc || '') + '</div><div class="src-meta">' + it.meta + '</div></div></' + tag + '>';
    }).join('');
    list.querySelectorAll('button[data-href]').forEach(function (btn) {
      btn.addEventListener('click', function () { window.location.href = btn.getAttribute('data-href'); });
    });
  }

  function wireAccordion(container) {
    container.querySelectorAll('.detail-item').forEach(function (item) {
      var head = item.querySelector('.di-head');
      var chev = item.querySelector('.chev');
      head.addEventListener('click', function () {
        var isExpanded = item.classList.toggle('expanded');
        chev.textContent = isExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down';
      });
    });
  }

  function renderArticle(article, allArticles) {
    // mypage의 "AI 리포트"/"분석 기록"이 실제 사용 기록을 반영하도록, 이 화면이
    // 실제 기사로 정상 로드될 때마다 방문 기록을 남긴다(EB.analysisHistory,
    // common.js). 토큰 소모는 이미 article.html의 "딥 리서치" 버튼에서 끝난
    // 뒤라 여기서는 순수하게 기록만 추가한다 — 토큰/라우팅 로직은 건드리지 않음.
    if (window.EB && window.EB.analysisHistory) window.EB.analysisHistory.add(article.id);
    var rng = makeRng(String(article.id));
    var profile = getProfile(article.category);
    renderHeader(article, rng);
    renderPreviewPoints(article, profile);
    renderCoreTab(article, profile, rng);
    renderMarketTab(article, profile, rng);
    renderDetailTab(article, profile);
    renderRelatedTab(article, profile, rng);
    renderSourcesTab(article, allArticles, profile);
  }

  // ---------------------------------------------------------------------
  // Existing screen behavior (loading -> report simulation, tabs, filter
  // pills, view toggle, source expand, reanalyze) — unchanged from the
  // original inline script, just moved into this file.
  // ---------------------------------------------------------------------
  function wireScreenBehavior() {
    var pctEl = document.getElementById('progress-pct-num');
    var etaEl = document.getElementById('eta-value');
    var ringFill = document.getElementById('progress-ring-fill');
    var ringCircumference = 226.195;
    var taskList = document.getElementById('task-list');
    var taskLine = document.getElementById('task-line');
    var taskItems = document.querySelectorAll('#task-list .task-item');

    function setTaskState(index, state) {
      var mark = taskItems[index].querySelector('.mark');
      var img = mark.querySelector('.gicon');
      mark.classList.remove('pending', 'pending-active');
      if (state === 'done') {
        img.style.display = 'flex';
      } else {
        img.style.display = 'none';
        mark.classList.add(state === 'active' ? 'pending-active' : 'pending');
      }
    }

    // Distance from `ancestor`'s own top edge to `el`'s top edge, walking the
    // offsetParent chain — entirely in `ancestor`'s local (pre-transform) coordinate
    // space. Unlike getBoundingClientRect(), this is unaffected by any ancestor's CSS
    // transform (e.g. the desktop portfolio mockup's `transform: scale(...)` on
    // .iphone-device — see assets/js/device-mockup.js): getBoundingClientRect()
    // reports the post-scale screen position, and assigning that straight into a
    // local CSS top/height (itself interpreted pre-scale, inside the same scaled
    // ancestor) double-applies the scale once the browser paints it — the line
    // rendered at scale^2 of its intended length instead of scale, landing short of
    // the last mark whenever the mockup was scaled down. offsetTop is a layout-box
    // value, immune to any ancestor transform, so it stays correct at any scale.
    function localTopWithin(el, ancestor) {
      var y = 0, node = el;
      while (node && node !== ancestor) {
        y += node.offsetTop;
        node = node.offsetParent;
      }
      return y;
    }

    // Line only connects analyzed ("done") steps to each other — never reaches
    // into the current/active or not-yet-analyzed steps below it.
    function updateTaskLine(doneCount) {
      if (!taskLine) return;
      if (doneCount < 2) { taskLine.style.display = 'none'; return; }
      var firstMark = taskItems[0].querySelector('.mark');
      var lastMark = taskItems[doneCount - 1].querySelector('.mark');
      var top = localTopWithin(firstMark, taskList) + firstMark.offsetHeight / 2;
      var bottom = localTopWithin(lastMark, taskList) + lastMark.offsetHeight / 2;
      taskLine.style.display = 'block';
      taskLine.style.top = top + 'px';
      taskLine.style.height = Math.max(0, bottom - top) + 'px';
    }

    ringFill.style.strokeDashoffset = ringCircumference;
    for (var s = 0; s < taskItems.length; s++) setTaskState(s, s === 0 ? 'active' : 'pending');
    updateTaskLine(0);

    var etaSeconds = 6;
    var totalTicks = 24;
    var tick = 0;

    var timer = setInterval(function () {
      tick++;
      var f = tick / totalTicks;
      var pct = Math.min(100, Math.round(f * 100));

      pctEl.textContent = pct;
      ringFill.style.strokeDashoffset = ringCircumference * (1 - pct / 100);

      var remaining = Math.max(0, Math.round(etaSeconds * (1 - f)));
      etaEl.textContent = remaining + '초 후';

      var doneCount = Math.min(taskItems.length, Math.floor(f * taskItems.length));
      for (var i = 0; i < taskItems.length; i++) {
        if (i < doneCount) setTaskState(i, 'done');
        else if (i === doneCount) setTaskState(i, 'active');
        else setTaskState(i, 'pending');
      }
      updateTaskLine(doneCount);

      if (tick >= totalTicks) {
        clearInterval(timer);
        for (var j = 0; j < taskItems.length; j++) setTaskState(j, 'done');
        updateTaskLine(taskItems.length);
        setTimeout(function () {
          document.getElementById('screen-loading').classList.remove('active');
          document.getElementById('screen-report').classList.add('active');
          document.getElementById('scroll-area').scrollTop = 0;
        }, 500);
      }
    }, 250);

    document.querySelectorAll('#tab-bar button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('#tab-bar button').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        document.getElementById('tab-' + btn.getAttribute('data-tab')).classList.add('active');
        document.getElementById('scroll-area').scrollTop = 0;
      });
    });

    document.querySelectorAll('.filter-pills button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.parentElement.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });
    document.querySelectorAll('.view-toggle button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.parentElement.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });

    var sourceList = document.querySelector('.source-list');
    var moreSourcesLabel = document.getElementById('more-sources-label');
    var moreSourcesIcon = document.getElementById('more-sources-icon');
    document.getElementById('more-sources-btn').addEventListener('click', function () {
      var expanded = sourceList.classList.toggle('expanded');
      document.querySelectorAll('.source-list .source-item.more-item, .source-list .source-item.was-more-item').forEach(function (el) {
        el.classList.toggle('more-item', !expanded);
        el.classList.toggle('was-more-item', expanded);
      });
      moreSourcesLabel.textContent = expanded ? '출처 접기' : '출처 더 보기';
      moreSourcesIcon.textContent = expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down';
    });

    // Wire whatever .detail-item accordions exist right now (the original
    // static demo content, for the case no article ever resolves). If an
    // article does resolve, renderDetailTab/renderMarketTab replace these
    // lists entirely and re-wire the fresh ones themselves via
    // wireAccordion — no double-binding, since the old nodes (and their
    // listeners) are discarded along with the old innerHTML.
    wireAccordion(document);

    document.getElementById('reanalyze-btn').addEventListener('click', function () {
      document.getElementById('screen-report').classList.remove('active');
      document.getElementById('screen-loading').classList.add('active');
      window.location.reload();
    });

    document.querySelectorAll('.fill-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        EB.share();
        var id = window.EBNews.resolveCurrentId();
        if (id) EB.sharedReports.add(id);
      });
    });
    document.querySelectorAll('.fb-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        EB.showToast('소중한 의견 감사합니다');
      });
    });
  }

  // ---------------------------------------------------------------------
  var currentId = window.EBNews.resolveCurrentId();
  wireScreenBehavior();
  if (currentId) {
    window.EBNews.loadArticles().then(function (allArticles) {
      var article = null;
      for (var i = 0; i < allArticles.length; i++) {
        if (String(allArticles[i].id) === String(currentId)) { article = allArticles[i]; break; }
      }
      if (article) renderArticle(article, allArticles);
      // no matching article: leave the original static demo content in place
    });
  }
})();
