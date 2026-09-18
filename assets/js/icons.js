/*
  EconomyBrief — icon component.
  Source: Figma "아이콘 컴퍼넌트" board (node 5118:75350), cross-referenced with
  design-system/iconography/iconography.md ("디자인시스템" > 05. Iconography).

  Most of the icons in the Figma file are instances of Google's "Material Symbols"
  icon library, not custom artwork. icon(name, opts) renders those as live glyphs
  from the Material Symbols Rounded variable font (loaded via Google Fonts in every
  page's <head>) instead of a flattened image, so they inherit `color` (recolorable
  via CSS, no more baked-in-color file variants like "bookmark-blue.svg") and stay
  crisp at any size. GLYPH_MAP carries the name -> {glyph, fill} mapping, verified
  against the official Material Symbols codepoints list.

  A handful of registry entries are genuine custom artwork (composite/multi-color
  compounds, decorative shapes, data-viz charts, brand logos) with no single-glyph
  Material Symbol equivalent — those are left out of GLYPH_MAP and still render as
  <img> from assets/img/icons/, exactly as before. See ICON_PATHS/ICON_RATIOS below.

  icon(name, opts) fits the icon inside an opts.size x opts.size box. For a mapped
  glyph that's just its font-size; for an unmapped image it preserves the source
  SVG's native width:height ratio (object-fit: contain) instead of stretching it.

  Exposes window.EB_ICONS = { icon, iconSrc, ratios, paths, glyphs }.
  Load this script BEFORE assets/js/common.js, which consumes it. Every page that
  uses icon() must also load the Material Symbols Rounded stylesheet in <head>:
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
  All glyphs render at weight 300 with round terminals (the Rounded style).
*/
(function () {
  var ICON_BASE = 'assets/img/icons/';

  // name -> [Material Symbols glyph name, FILL (0 outline / 1 filled)]
  var GLYPH_MAP = {
    'home-fill': ['home', 1],
    'home-line': ['home', 0],
    'newsmode-fill': ['newsmode', 1],
    'newsmode-line': ['newsmode', 0],
    'newsmode-badge-blue': ['newsmode', 0],
    'newsmode-badge-blue2': ['newsmode', 0],
    'newsmode-badge-gray': ['newsmode', 0],
    'account-circle-fill': ['account_circle', 1],
    'account-circle-line': ['account_circle', 0],
    'arrow-back-ios-new': ['arrow_back_ios_new', 0],
    'bookmark': ['bookmark', 0],
    'bookmark-fill': ['bookmark', 1],
    'bookmark-blue': ['bookmark', 1],
    'search': ['search', 0],
    'notifications': ['notifications', 0],
    'notifications-blue': ['notifications', 0],
    'notifications-badge-gray': ['notifications', 0],
    'share': ['share', 0],
    'close': ['close', 0],
    'check': ['check', 0],
    'check-blue': ['check', 0],
    'star-filled': ['star', 1],
    'star-outline': ['star', 0],
    'play-circle': ['play_circle', 0],
    'play-arrow': ['play_arrow', 1],
    'assignment': ['assignment', 0],
    'assignment-badge-gray': ['assignment', 0],
    'campaign': ['campaign', 0],
    'sync-alt': ['sync_alt', 0],
    'keyboard-arrow-down': ['keyboard_arrow_down', 0],
    'keyboard-arrow-up': ['keyboard_arrow_up', 0],
    'keyboard-arrow-down-alt': ['keyboard_arrow_down', 0],
    'add': ['add', 0],
    'mindfulness': ['mindfulness', 0],
    'smart-toy': ['smart_toy', 0],
    'smart-toy-badge-gray': ['smart_toy', 0],
    'mode-heat': ['mode_heat', 0],
    'arrow-drop-up': ['arrow_drop_up', 1],
    'upload': ['upload', 0],
    'upload-badge-gray': ['upload', 0],
    'thumb-up': ['thumb_up', 0],
    'thumb-down': ['thumb_down', 0],
    'psychology': ['psychology', 0],
    'question-mark-badge-gray': ['question_mark', 0],
    'question-mark-badge': ['question_mark', 0],
    'comment-badge': ['comment', 0],
    'shield-lock-badge': ['shield_lock', 0],
    'dark-mode-badge': ['dark_mode', 0],
    'match-case-badge': ['match_case', 0],
    'public-badge': ['public', 0],
    'schedule': ['schedule', 0],
    'book-5': ['book_5', 0],
    'folder': ['folder', 0],
    'lightbulb': ['lightbulb', 0],
    'trending-up': ['trending_up', 0],
    'query-stats': ['query_stats', 0],
    'pie-chart': ['pie_chart', 0],
    'finance-mode': ['finance_mode', 0],
    'alarm-on': ['alarm_on', 0],
    'encrypted': ['encrypted', 0],
    'my-location': ['my_location', 0],
    'gift': ['redeem', 0],
    'tooltip-chat': ['chat_bubble', 0],
    'source-banner-icon': ['verified_user', 0],
    'status-cellular': ['signal_cellular_alt', 0],
    'status-wifi': ['wifi', 0],
    'status-battery': ['battery_full', 1]
  };

  // Remaining entries: genuine custom artwork (composite/multi-color compounds,
  // decorative backdrops, data-viz charts, brand logos) — no single Material Symbol
  // covers these, so they keep rendering as flattened <img> exports.
  var ICON_PATHS = {
    'play-button-bg': 'play-button-bg.svg',
    'status-levels': 'status-levels.svg',
    'cta-pointer-triangle': 'cta-pointer-triangle.svg',
    'hairline-divider': 'hairline-divider.svg',
    'dim-overlay': 'dim-overlay.svg',
    'graph-5': 'graph-5.svg',
    'graph-8': 'graph-8.svg',
    'sparkline-1': 'sparkline-1.svg',
    'sparkline-2': 'sparkline-2.svg',
    'donut-chart': 'donut-chart.svg',
    'legend-dot-1': 'legend-dot-1.svg',
    'legend-dot-2': 'legend-dot-2.svg',
    'legend-dot-3': 'legend-dot-3.svg',
    'legend-dot-4': 'legend-dot-4.svg',
    'source-cnbc': 'source-cnbc.svg',
    'source-reuters': 'source-reuters.svg',
    'source-bloomberg': 'source-bloomberg.svg',
    'source-ft': 'source-ft.svg',
    'onboarding-circle-bg': 'onboarding-circle-bg.svg',
    'avatar-bg': 'avatar-bg.svg',
    'camera-badge-bg': 'camera-badge-bg.svg',
    'token-charge-badge': 'token-charge-badge.svg',
    'dot-active': 'dot-active.svg',
    'dot-inactive': 'dot-inactive.svg',
    'badge-target': 'badge-target.svg',
    'arrow-forward-ios': 'arrow-forward-ios.svg',
    'notify-toggle': 'notify-toggle.svg'
  };

  // Natural [width, height] read directly from each SVG's own viewBox — the source of
  // truth for its ratio. Only consulted for names NOT present in GLYPH_MAP (image
  // fallback path). Entries omitted here (or with equal w/h) render as a plain square.
  var ICON_RATIOS = {
    'status-levels': [100, 22],
    'cta-pointer-triangle': [11.5293, 10.25],
    'graph-5': [14.25, 14.25],
    'sparkline-1': [136, 40.2423],
    'sparkline-2': [148.858, 41],
    'donut-chart': [124.002, 124],
    'source-cnbc': [24.1298, 20.4544],
    'source-bloomberg': [17.6842, 21],
    'source-ft': [24.7267, 13.5476],
    'camera-badge-bg': [14, 14],
    'token-charge-badge': [14, 14],
    'play-button-bg': [50, 50],
    'badge-target': [13.4583, 13.4583],
    'arrow-forward-ios': [10, 24],
    'notify-toggle': [35, 48]
  };

  function iconSrc(name) {
    var file = ICON_PATHS[name];
    return file ? ICON_BASE + file : '';
  }

  // Fits the icon inside an opts.size x opts.size box.
  // - Mapped names render as a live Material Symbols Rounded glyph (<span>), sized by
  //   font-size and recolorable via opts.color or the caller's own CSS `color`.
  // - Unmapped names fall back to the legacy <img>, preserving its native ratio
  //   (object-fit: contain) instead of stretching it.
  function icon(name, opts) {
    opts = opts || {};
    var box = opts.size || 24;
    var alt = opts.alt || '';
    var cls = opts.class ? ' ' + opts.class : '';

    var glyph = GLYPH_MAP[name];
    if (glyph) {
      var settings = "'FILL' " + glyph[1] + ", 'wght' 300, 'GRAD' 0, 'opsz' 24";
      var style = 'font-size:' + box + 'px; width:' + box + 'px; height:' + box + 'px;' +
        ' font-variation-settings:' + settings + ';';
      if (opts.color) style += ' color:' + opts.color + ';';
      return '<span class="gicon' + cls + '" style="' + style + '" role="img" aria-label="' + alt + '">' + glyph[0] + '</span>';
    }

    var src = iconSrc(name);
    if (!src) return '';
    var w = box, h = box;
    var natural = ICON_RATIOS[name];
    if (natural && natural[0] !== natural[1]) {
      var ratio = natural[0] / natural[1];
      if (ratio >= 1) { w = box; h = box / ratio; } else { h = box; w = box * ratio; }
    }
    return '<img' + cls + ' src="' + src + '" alt="' + alt + '" style="width:' + w + 'px;height:' + h + 'px;display:block;" />';
  }

  window.EB_ICONS = { icon: icon, iconSrc: iconSrc, ratios: ICON_RATIOS, paths: ICON_PATHS, glyphs: GLYPH_MAP };
})();
