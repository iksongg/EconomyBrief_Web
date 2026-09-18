/*
  EconomyBrief_Web — browser app shell behavior (was: desktop portfolio
  device mockup behavior). Pairs with assets/css/device-mockup.css, which
  now collapses the iPhone-frame wrapper markup at every width instead of
  just below 700px, so this file's one remaining job is:
    1. Let a mouse click-and-drag any horizontally-scrolling row inside
       the app (stories, highlight cards, trend cards, filter pills...).
       Those rows were built for touch swipe, which a desktop mouse can't
       do — this adds the drag *gesture* only, it doesn't change what's
       in the row or how it's laid out. Touch/pen input is left alone
       (gated on event.pointerType === 'mouse'), so real phones behave
       exactly as before.
  The other original job - shrinking the iPhone frame with transform:
  scale() so it fit short/narrow desktop windows - no longer applies here:
  there is no frame to scale, the browser viewport itself is the app.
  Never touches anything inside .device beyond the drag gesture above —
  purely presentational/interaction chrome, no markup or app-logic changes.
*/
(function () {
  // Any element the app already made horizontally scrollable (overflow-x:
  // auto/scroll, with more content than fits) gets mouse-drag support —
  // found generically so this keeps working if the app adds more rows
  // later, instead of hardcoding a class list here.
  function findScrollRows() {
    var rows = [];
    document.querySelectorAll('.device *').forEach(function (el) {
      var style = getComputedStyle(el);
      if (
        (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
        el.scrollWidth > el.clientWidth + 1
      ) {
        rows.push(el);
      }
    });
    return rows;
  }

  function enableDragScroll(el) {
    var dragging = false;
    var startX = 0;
    var startScroll = 0;
    var moved = false;

    // Move/up listen on `document`, not `el` — once the drag has moved the
    // row's content, the cursor is no longer necessarily over `el` (or over
    // whatever card is now under it), so tracking has to be global for the
    // rest of the gesture. This is the standard pattern and doesn't depend
    // on pointer capture, which doesn't reliably engage for a mouse here.
    function onPointerMove(e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      el.scrollLeft = startScroll - dx;
    }

    function onPointerUp() {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('eb-drag-scrolling');
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      if (moved) {
        // The drag just ended on top of a clickable card — swallow only
        // the click that fires immediately after this gesture (if any) so
        // dragging never also triggers navigation. Cleaned up on the next
        // tick so it can never affect a later, unrelated click.
        document.addEventListener('click', suppressClick, true);
        setTimeout(function () {
          document.removeEventListener('click', suppressClick, true);
        }, 0);
      }
    }
    function suppressClick(e) {
      e.stopPropagation();
      e.preventDefault();
    }

    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse') return; // touch/pen already scroll natively
      if (e.button !== 0) return; // left button only
      // Rows like the story circles and highlight cards contain <img>
      // elements, which browsers make natively draggable by default —
      // without this, a mousedown+move on the image starts the browser's
      // own "drag this image out" gesture instead of scrolling the row,
      // and every subsequent pointermove goes to that instead of us.
      e.preventDefault();
      dragging = true;
      moved = false;
      startX = e.clientX;
      startScroll = el.scrollLeft;
      el.classList.add('eb-drag-scrolling');
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerUp);
    });

    // Belt-and-braces: explicitly disable the same native image-drag on
    // every <img> inside the row, in case some browser still initiates it
    // before pointerdown's preventDefault takes effect.
    el.querySelectorAll('img').forEach(function (img) {
      img.draggable = false;
    });

    el.classList.add('eb-drag-scrollable');
  }

  function initDragScroll() {
    findScrollRows().forEach(enableDragScroll);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDragScroll);
  } else {
    initDragScroll();
  }
})();
