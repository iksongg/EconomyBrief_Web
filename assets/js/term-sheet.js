/*
  Term definition bottom sheet — shared component (see assets/css/term-sheet.css
  for the markup contract). Wires up:
    - any [data-term="<id>"] element to open the sheet with that term's copy
    - tapping the dim backdrop to close it
    - the save button to EB.glossary.save(...), with the same
      "저장완료 ✓" / "이미 저장됨" feedback used across the site

  Add new terms here as the site grows — this is the single source of truth
  so every page's term triggers stay in sync.
*/
(function () {
  var TERMS = {
    pf: {
      term: '프로젝트파이낸싱(PF)',
      definition: '부동산 개발 사업에 필요한 자금을 미리 빌리는 금융 방식',
      category: '부동산'
    },
    hbm: {
      term: 'HBM',
      definition: '여러 개의 D램을 수직으로 쌓아 데이터 처리 속도를 크게 높인 고성능 메모리',
      category: '반도체'
    }
  };

  function init() {
    var overlay = document.getElementById('term-overlay-bg');
    var sheet = document.getElementById('term-popup');
    if (!overlay || !sheet) return;

    var titleEl = sheet.querySelector('.ts-title');
    var descEl = sheet.querySelector('.ts-desc');
    var saveBtn = sheet.querySelector('.ts-save');
    var saveLabel = saveBtn ? saveBtn.textContent : '용어저장';
    var current = null;

    function open(termId) {
      var term = TERMS[termId];
      if (!term) return;
      current = term;
      if (titleEl) titleEl.textContent = term.term;
      if (descEl) descEl.textContent = term.definition;
      overlay.classList.add('visible');
      sheet.classList.add('visible');
    }

    function close() {
      overlay.classList.remove('visible');
      sheet.classList.remove('visible');
    }

    // Delegated on document (not bound per-element) because pages like
    // daily-briefing.html swap article-body.innerHTML per article, replacing
    // any [data-term] elements found at load time with fresh ones.
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-term]');
      if (!trigger) return;
      e.stopPropagation();
      open(trigger.getAttribute('data-term'));
    });

    overlay.addEventListener('click', close);

    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (!current || !window.EB) return;
        var result = EB.glossary.save(current);
        saveBtn.textContent = result.added ? '저장완료 ✓' : '이미 저장됨';
        setTimeout(function () {
          close();
          saveBtn.textContent = saveLabel;
        }, 700);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
