import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

/* ─────────────────────────────────────────────────────────────────────────
   PersistentHtmlIframe
   ──────────────────────────────────────────────────────────────────────────
   An iframe that stays mounted across navigation. Instead of remounting and
   re-running the slideshow framework from scratch every time the target
   slide changes, it uses postMessage to send "goto N" commands to a small
   navigation engine injected into the user's HTML.

   The injected engine:
   • Tracks the iframe's current internal slide.
   • Tries reveal.js / impress.js APIs first (instant).
   • Falls back to URL hash navigation.
   • Falls back to simulated ArrowRight/ArrowLeft keypresses.
   • Disables CSS transitions ONLY for multi-step jumps (so a single
     next/prev plays its natural transition smoothly).
   • Posts "pulse-ready" back when done so the parent can hide the splash.

   The brand splash overlay only appears for "big jumps" (delta ≥ 4) so
   that routine next/prev navigation feels seamless with no dim flash.
   ───────────────────────────────────────────────────────────────────────── */

export interface PersistentHtmlIframeProps {
  html:        string
  fileName:    string
  /** Whether this iframe should be visible right now. Hidden iframes stay
   *  mounted (we just fade them out and disable pointer events). */
  visible:     boolean
  /** Which internal slide to show. null = don't navigate (keep current). */
  targetIndex: number | null
  /** Threshold (delta) above which the brand splash appears. Default 2 —
   *  any multi-step navigation gets covered so the rapid keypress
   *  shuffle isn't visible. Single-step (delta=1) plays naturally. */
  splashThreshold?: number
  /** Optional wrapper className override (defaults to absolute inset-0). */
  containerClassName?: string
  /** When false, mouse/keyboard input cannot reach the iframe — Pulse
   *  owns all navigation. Used in slideshow mode so the HTML's internal
   *  next/prev buttons don't bypass the inserted question slides.
   *  Default true (editor mode allows interaction). */
  interactive?: boolean
}

export function PersistentHtmlIframe({
  html,
  fileName,
  visible,
  targetIndex,
  splashThreshold = 2,
  containerClassName,
  interactive = true,
}: PersistentHtmlIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [busy, setBusy] = useState(true)
  const [currentInternalIndex, setCurrentInternalIndex] = useState(0)

  // Capture the *initial* target AND the interactive flag so srcDoc is
  // stable across re-renders. useMemo only re-runs when html changes
  // (iframe key change → remount).
  const initialTargetRef = useRef(targetIndex ?? 0)
  const interactiveRef   = useRef(interactive)
  const srcDoc = useMemo(
    () => injectPersistentHtmlNavScript(
      html,
      initialTargetRef.current,
      !interactiveRef.current,  // when not interactive, intercept user keys
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [html],
  )

  // Listen for callbacks from inside the iframe:
  //   • pulse-ready → hide splash + record current internal index
  //   • pulse-key   → re-dispatch the keystroke on the parent window so
  //                   Pulse's outer keyboard handler picks it up. This is
  //                   how non-interactive mode forwards arrow keys to
  //                   the slideshow navigator without letting the HTML's
  //                   own nav handle them.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const win = iframeRef.current?.contentWindow
      if (!win || e.source !== win) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = e.data as any
      if (!data || typeof data !== 'object') return
      if (data.type === 'pulse-ready') {
        setBusy(false)
        if (typeof data.currentIndex === 'number') {
          setCurrentInternalIndex(data.currentIndex)
        }
      } else if (data.type === 'pulse-key' && typeof data.key === 'string') {
        try {
          window.dispatchEvent(new KeyboardEvent('keydown', {
            key: data.key, bubbles: true, cancelable: true,
          }))
        } catch { /* ignore */ }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // When the target changes (after the iframe is ready), post a goto command.
  useEffect(() => {
    if (busy) return
    if (targetIndex === null) return
    if (targetIndex === currentInternalIndex) return
    const win = iframeRef.current?.contentWindow
    if (!win) return
    setBusy(true)
    win.postMessage({ type: 'pulse-goto', target: targetIndex }, '*')
  }, [busy, targetIndex, currentInternalIndex])

  // Safety: never let the splash stick around forever if the iframe
  // doesn't respond (e.g. very stubborn slideshow framework).
  useEffect(() => {
    if (!busy) return
    const id = window.setTimeout(() => setBusy(false), 4000)
    return () => window.clearTimeout(id)
  }, [busy])

  // Big-jump detection — only show splash when the catch-up is meaningful.
  // For delta=1 (normal next/prev), we let the natural transition play with
  // no overlay. For delta≥splashThreshold we cover with the brand splash.
  // (The old code also OR'd against initialTargetRef which made the splash
  // flash on EVERY navigation after a cold-mount at slide ≥ 2 — that was
  // the "flash on every next/prev" bug. The pendingDelta naturally covers
  // cold-mount too because currentInternalIndex starts at 0.)
  const pendingDelta = targetIndex !== null
    ? Math.abs(targetIndex - currentInternalIndex)
    : 0
  const isBigJump = pendingDelta >= splashThreshold

  return (
    <div
      aria-hidden={!visible}
      className={containerClassName ?? 'absolute inset-0 transition-opacity duration-300'}
      style={{
        opacity:       visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        zIndex:        visible ? 15 : 0,
      }}
    >
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        title={fileName}
        sandbox="allow-scripts allow-popups allow-modals"
        className="h-full w-full border-0 bg-white"
      />
      {/* Brand splash overlay — only for genuine big jumps */}
      <AnimatePresence>
        {busy && visible && isBigJump && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-midnight-sky-900"
          >
            <div className="text-2xl font-bold tracking-tight text-white md:text-3xl">
              alaya <span className="text-hot-pink">pulse</span>
            </div>
            <div className="mt-5 flex items-center gap-1.5">
              {[0, 1, 2].map(i => (
                <motion.span
                  key={i}
                  className="inline-block size-1.5 rounded-full bg-hot-pink"
                  animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                  transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Builds the HTML payload with an injected navigation engine.
 * The engine handles initial navigation on load AND incoming postMessage
 * commands so the parent can navigate without remounting the iframe.
 *
 * When `interceptKeys` is true, the engine also blocks user keyboard
 * navigation (ArrowRight/Left/Up/Down, Space, PageUp/Down) from reaching
 * the HTML's own slideshow framework, and forwards those keys to the
 * parent window via postMessage. Used in slideshow mode so the HTML's
 * internal navigation doesn't skip past Pulse's question slides.
 */
export function injectPersistentHtmlNavScript(
  html: string,
  initialTarget: number,
  interceptKeys: boolean = false,
): string {
  const navScript = `
<script>
(function() {
  var currentIndex = 0;
  var navigating = false;
  var initialTarget = ${initialTarget};
  var interceptKeys = ${interceptKeys ? 'true' : 'false'};

  // ── Block the HTML's own next/prev nav (keyboard + nav buttons) so it
  //    can't skip past inserted Pulse question slides. The iframe stays
  //    fully interactive otherwise — animations, hover effects, embedded
  //    media, and non-nav clicks all work normally. Synthetic events
  //    that WE dispatch (isTrusted=false) pass through unaffected.
  if (interceptKeys) {
    var BLOCKED_KEYS = {
      ArrowRight: 1, ArrowLeft: 1, ArrowUp: 1, ArrowDown: 1,
      ' ': 1, 'Spacebar': 1, PageUp: 1, PageDown: 1, Home: 1, End: 1,
      Enter: 1,
    };
    function interceptKey(e) {
      if (!e.isTrusted) return;            // our own keypresses pass through
      if (!BLOCKED_KEYS[e.key]) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (e.type === 'keydown') {
        try { window.parent.postMessage({ type: 'pulse-key', key: e.key }, '*'); } catch (ex) {}
      }
    }
    ['keydown','keypress','keyup'].forEach(function(t) {
      document.addEventListener(t, interceptKey, true);
      window.addEventListener(t, interceptKey, true);
    });

    // Heuristic nav-button detector — walks up the DOM looking for common
    // patterns: classes/ids/aria-labels containing "next"/"prev"/"back",
    // or short text content matching arrow glyphs (→ ← ❯ ❮ » « ▶ ◀ > <).
    // Conservative — biased toward false negatives over false positives so
    // legitimate interactive buttons (videos, modals, etc.) keep working.
    var NAV_WORD_RE = /(^|[\\s_\\-])(next|prev|previous|back|forward)([\\s_\\-]|$)/i;
    var ARROW_TEXT_RE = /^(next|prev|previous|back|forward|→|←|»|«|▶|◀|❯|❮|>|<)([\\s→←»«▶◀❯❮><]+|$)/i;
    function looksLikeNavButton(node) {
      var el = node;
      var hops = 0;
      while (el && el.nodeType === 1 && el !== document.body && hops < 5) {
        var pieces = [];
        try {
          var cls = el.className;
          if (cls && cls.baseVal !== undefined) cls = cls.baseVal;  // SVG
          if (cls) pieces.push(String(cls));
        } catch (ex) {}
        try { if (el.id) pieces.push(String(el.id)); } catch (ex) {}
        try {
          var al = el.getAttribute && el.getAttribute('aria-label');
          if (al) pieces.push(String(al));
        } catch (ex) {}
        try {
          var da = el.getAttribute && el.getAttribute('data-action');
          if (da) pieces.push(String(da));
        } catch (ex) {}
        var joined = pieces.join(' ');
        if (joined && NAV_WORD_RE.test(joined)) return true;

        // Short button text matching an arrow / nav word
        try {
          if ((el.tagName === 'BUTTON' || el.tagName === 'A') && el.textContent) {
            var txt = String(el.textContent).trim();
            if (txt.length <= 12 && ARROW_TEXT_RE.test(txt)) return true;
          }
        } catch (ex) {}

        el = el.parentElement;
        hops++;
      }
      return false;
    }

    function interceptClick(e) {
      if (!e.isTrusted) return;
      if (!looksLikeNavButton(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }
    ['click','mousedown','mouseup','pointerdown','pointerup','touchstart','touchend'].forEach(function(t) {
      document.addEventListener(t, interceptClick, true);
    });

    // ── Drag-to-scroll for vertically long slides ───────────────────────
    // Only enabled when Pulse owns navigation (interceptKeys=true). For
    // unsplit HTML decks the iframe is fully interactive — we leave all
    // mouse behaviour alone so the HTML's own buttons/links work normally.
    (function() {
      var dragging = false;
      var moved    = false;
      var startY   = 0;
      var startScrollTop = 0;
      var scrollable = null;

      function getScrollable() {
        var el = document.scrollingElement || document.documentElement;
        if (!el) return null;
        return el.scrollHeight > el.clientHeight + 4 ? el : null;
      }

      document.addEventListener('mousedown', function(e) {
        if (!e.isTrusted) return;
        if (e.button !== 0) return;
        var tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A') return;
        scrollable = getScrollable();
        if (!scrollable) return;
        dragging = true;
        moved = false;
        startY = e.clientY;
        startScrollTop = scrollable.scrollTop;
      }, true);

      document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        var dy = e.clientY - startY;
        if (!moved && Math.abs(dy) > 4) {
          moved = true;
          try { document.body && (document.body.style.cursor = 'grabbing'); } catch (ex) {}
        }
        if (moved) {
          if (scrollable) scrollable.scrollTop = startScrollTop - dy;
          e.preventDefault();
        }
      }, true);

      function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        try { document.body && (document.body.style.cursor = ''); } catch (ex) {}
        if (moved) {
          var swallow = function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
            document.removeEventListener('click', swallow, true);
          };
          document.addEventListener('click', swallow, true);
          setTimeout(function() { document.removeEventListener('click', swallow, true); }, 100);
        }
      }
      document.addEventListener('mouseup',   endDrag, true);
      document.addEventListener('mouseleave', endDrag, true);
    })();
  }

  function fireKey(key, keyCode) {
    // Dispatch ONE event on ONE target. The previous version dispatched
    // keydown/keypress/keyup × activeElement/document/window = 9 events
    // per "key", which made the HTML's keyboard handler fire multiple
    // times per call (via event bubbling), advancing many slides per
    // single fireKey() invocation. Single keydown on document is what
    // every slideshow framework listens to, and only fires ONCE.
    try {
      var ev = new KeyboardEvent('keydown', {
        key: key, code: key, keyCode: keyCode, which: keyCode,
        bubbles: true, cancelable: true,
      });
      document.dispatchEvent(ev);
    } catch (e) {}
  }

  function disableTransitions() {
    if (document.getElementById('__pulse_notrans')) return;
    var s = document.createElement('style');
    s.id = '__pulse_notrans';
    s.textContent = '*,*::before,*::after { transition: none !important; animation-duration: 0s !important; animation-delay: 0s !important; }';
    (document.head || document.documentElement).appendChild(s);
  }
  function enableTransitions() {
    var s = document.getElementById('__pulse_notrans');
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }

  function postReady() {
    try { window.parent.postMessage({ type: 'pulse-ready', currentIndex: currentIndex }, '*'); } catch (e) {}
  }

  // ── Read the HTML's own slide counter from the DOM ─────────────────
  // Many slideshow templates render a counter like "2 / 30" or "2 of 30"
  // somewhere on screen. When present, this is the most reliable source
  // of truth for "what slide are we actually on" — much better than our
  // own tracker, which can drift if the HTML auto-advances or our
  // keypress navigation misfires.
  // Returns 0-indexed slide number, or null if no counter was found.
  function detectCurrentSlide() {
    try {
      // Strict pattern: must be EXACTLY a "N", "N/M", or "N of M" counter.
      // No extra text allowed (so "Episode 7" or "5 minutes left" won't match).
      var STRICT = /^(\\d+)(?:\\s*(?:\\/|of)\\s*(\\d+))?$/i;
      var STRICT_NM = /^(\\d+)\\s*(?:\\/|of)\\s*(\\d+)$/i;

      // Strategy 1: counter-specific class/id selectors
      var counterSels = [
        '.slide-counter','.slide-number','.page-counter','.page-number',
        '.current-slide','.slide-indicator',
        '[class~="counter"]','[class~="slide-num"]','[class~="page-num"]',
        '[data-slide-counter]','[data-position]',
      ];
      for (var i = 0; i < counterSels.length; i++) {
        try {
          var els = document.querySelectorAll(counterSels[i]);
          for (var j = 0; j < els.length; j++) {
            var t = (els[j].textContent || '').trim();
            if (t.length > 20 || t.length === 0) continue;
            var m = t.match(STRICT);
            if (m) {
              var n = parseInt(m[1], 10);
              var tot = m[2] ? parseInt(m[2], 10) : null;
              if (!isNaN(n) && n >= 1 && n <= 999 && (tot === null || (tot >= 2 && n <= tot))) {
                return n - 1;
              }
            }
          }
        } catch (e) {}
      }
      // Strategy 2: walk small text containers looking for "N / M" exactly.
      // Require both N and M so we don't match standalone numbers (1, 7, 30).
      var allEls = document.querySelectorAll('span, p, div, footer, header, small, b, strong, em, i, td');
      var max = Math.min(allEls.length, 800);
      for (var k = 0; k < max; k++) {
        var el = allEls[k];
        var text = (el.innerText || '').trim();
        if (text.length > 20 || text.length < 3) continue;
        var pat = text.match(STRICT_NM);
        if (pat) {
          var cur = parseInt(pat[1], 10);
          var tt = parseInt(pat[2], 10);
          if (!isNaN(cur) && !isNaN(tt) && cur >= 1 && cur <= tt && tt >= 2 && tt <= 999) {
            return cur - 1;
          }
        }
      }
    } catch (e) {}
    return null;
  }

  // ── Slide-change detector ───────────────────────────────────────────
  // Many HTML slideshows use arrow-key presses for BOTH slide changes AND
  // internal animation steps (revealing bullets, transitions). To avoid
  // skipping slides during navigation, we fingerprint the visible state
  // before and after each keypress: if the fingerprint is unchanged, the
  // keypress was just an animation step — fire another. If changed, count
  // it as one real slide advance.
  function fingerprintSlide() {
    var fp = '';
    try { fp += '#' + (window.location.hash || ''); } catch (e) {}
    try { fp += '|t:' + (document.title || ''); } catch (e) {}
    try {
      // Common slide containers — capture which one is currently "active"
      var SLIDE_SEL = '.reveal .slides > section, .slides > section, .step, [data-slide], section.slide, div.slide, .slide, .page';
      var nodes = document.querySelectorAll(SLIDE_SEL);
      for (var i = 0; i < nodes.length; i++) {
        var n  = nodes[i];
        var cn = (n.className && (n.className.baseVal !== undefined ? n.className.baseVal : n.className)) || '';
        cn = String(cn);
        var isActive = /(^|\\s)(active|current|present|visible|show|focused)(\\s|$)/.test(cn);
        if (!isActive) {
          try {
            if (n.getAttribute && n.getAttribute('aria-hidden') === 'false') isActive = true;
          } catch (e) {}
        }
        if (isActive) fp += '|a' + i;
      }
    } catch (e) {}
    try {
      // Fallback: hash of first 400 chars of visible text — catches changes
      // even for frameworks that don't mark slides with classes.
      var txt = (document.body && document.body.innerText) || '';
      fp += '|x:' + txt.substring(0, 400);
    } catch (e) {}
    return fp;
  }

  function log() {
    try { console.log.apply(console, ['[pulse-nav]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  function navigateTo(target, done, forceFastPath) {
    var detected = detectCurrentSlide();
    if (detected !== null) currentIndex = detected;
    log('navigateTo', { target: target, currentIndex: currentIndex, detected: detected });

    if (target === currentIndex) { log('already at target'); done(); return; }

    // 1) reveal.js — instant API
    try {
      if (window.Reveal && typeof Reveal.slide === 'function') {
        log('using Reveal API');
        Reveal.slide(target);
        currentIndex = target;
        done(); return;
      }
    } catch (e) {}
    // 2) impress.js — instant API
    try {
      if (window.impress) {
        log('using impress API');
        window.impress().goto(target);
        currentIndex = target;
        done(); return;
      }
    } catch (e) {}
    // 3) Hash navigation
    try { window.location.hash = '#/' + target; } catch (e) {}

    // 4) Keypress nav with slide-change counting + iframe settle detection.
    //    After firing a key we WAIT for the iframe's fingerprint to be
    //    stable (no changes for 50ms) — that means the HTML has finished
    //    reacting to the key (transition complete, etc.). Only THEN do we
    //    count whether the slide actually advanced and decide whether to
    //    fire the next key. This prevents the old over-firing bug.
    var delta    = target - currentIndex;
    var slidesToAdvance = Math.abs(delta);
    var fastPath = forceFastPath || slidesToAdvance >= 2;
    if (fastPath) disableTransitions();
    log('keypress nav', { delta: delta, slidesToAdvance: slidesToAdvance, fastPath: fastPath });

    var key     = delta > 0 ? 'ArrowRight' : 'ArrowLeft';
    var keyCode = delta > 0 ? 39 : 37;
    var advanced = 0;
    var stuckRounds = 0;
    var totalKeys = 0;
    var maxKeys = slidesToAdvance * 5 + 15;

    function complete() {
      log('complete', { advanced: advanced, totalKeys: totalKeys, stuckRounds: stuckRounds, finalIndex: currentIndex });
      setTimeout(function() {
        if (fastPath) enableTransitions();
        done();
      }, 30);
    }

    function fireOne() {
      // Re-check via detection — if we've already arrived (e.g. via hash
      // navigation triggered by an API), short-circuit.
      var liveIdx = detectCurrentSlide();
      if (liveIdx !== null) currentIndex = liveIdx;
      if (currentIndex === target) { complete(); return; }
      // Overshoot guard — if a key advanced more than expected and we've
      // passed the target, STOP. Don't keep firing the same direction.
      var overshot = (delta > 0 && currentIndex > target) || (delta < 0 && currentIndex < target);
      if (overshot) {
        log('overshot', { currentIndex: currentIndex, target: target, delta: delta });
        complete();
        return;
      }
      if (totalKeys >= maxKeys || stuckRounds >= 5) {
        log('giving up', { totalKeys: totalKeys, stuckRounds: stuckRounds, maxKeys: maxKeys });
        complete();
        return;
      }

      var idxBefore = currentIndex;
      var fpBefore  = fingerprintSlide();
      fireKey(key, keyCode);
      totalKeys++;

      // Wait for iframe to settle (fingerprint stable for >= settleNeeded
      // consecutive polls) OR maxWait timeout, then check what changed.
      var elapsed = 0;
      var interval = 25;
      var maxWait = fastPath ? 300 : 750;
      var settleNeeded = 2;  // 2 × 25ms = 50ms of no fingerprint change
      var stableCount = 0;
      var lastFp = fpBefore;

      function poll() {
        var fpNow = fingerprintSlide();
        if (fpNow === lastFp) stableCount++;
        else { stableCount = 0; lastFp = fpNow; }
        elapsed += interval;

        if (stableCount >= settleNeeded || elapsed >= maxWait) {
          var idxNow = detectCurrentSlide();
          var counterChanged = (idxNow !== null && idxBefore !== null && idxNow !== idxBefore);
          var fpChanged = (fpNow !== fpBefore);

          if (counterChanged) {
            currentIndex = idxNow;
            advanced++;
            stuckRounds = 0;
          } else if (idxNow === null && fpChanged) {
            // No counter but content changed — assume one advance
            currentIndex = delta > 0 ? currentIndex + 1 : currentIndex - 1;
            advanced++;
            stuckRounds = 0;
          } else if (fpChanged) {
            // Animation step (bullet reveal, etc.) — key consumed but no
            // slide change. Don't increment advanced, don't increment stuck.
            stuckRounds = 0;
          } else {
            // Nothing changed — HTML ignored the key
            stuckRounds++;
          }
          fireOne();
          return;
        }
        setTimeout(poll, interval);
      }
      setTimeout(poll, interval);
    }
    fireOne();
  }

  // ── Rewind to absolute slide 0 ──────────────────────────────────────
  // Don't assume the iframe loaded at slide 0 — many HTML decks auto-
  // advance, persist state in the URL hash, or use a non-zero starting
  // slide. Without this rewind, our slideIndex mapping would be off by
  // some constant offset (every Pulse slide showing the wrong HTML slide).
  function rewindToStart(done) {
    // Try framework APIs (instant)
    try {
      if (window.Reveal && typeof Reveal.slide === 'function') {
        Reveal.slide(0);
        currentIndex = 0;
        done(); return;
      }
    } catch (e) {}
    try {
      if (window.impress) {
        window.impress().goto(0);
        currentIndex = 0;
        done(); return;
      }
    } catch (e) {}

    // Otherwise: clear hash, hit Home, then fire ArrowLeft until the
    // fingerprint stops changing (we've reached the leftmost slide).
    try { window.location.hash = '#/0'; } catch (e) {}
    fireKey('Home', 36);

    setTimeout(function() {
      var attempts = 0;
      var stagnant = 0;
      var lastFp   = fingerprintSlide();
      function step() {
        if (attempts >= 80 || stagnant >= 3) {
          currentIndex = 0;
          done();
          return;
        }
        fireKey('ArrowLeft', 37);
        attempts++;
        setTimeout(function() {
          var newFp = fingerprintSlide();
          if (newFp === lastFp) stagnant++;
          else { stagnant = 0; lastFp = newFp; }
          step();
        }, 35);
      }
      step();
    }, 60);
  }

  window.addEventListener('message', function(e) {
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.type !== 'pulse-goto') return;
    if (navigating) return;
    var target = e.data.target;
    if (typeof target !== 'number') return;
    navigating = true;
    navigateTo(target, function() {
      navigating = false;
      postReady();
    });
  });

  // Bootstrap: detect actual position from the DOM, then navigate to
  // initialTarget. Wait 200ms first so the HTML's own scripts get a
  // chance to settle (some decks auto-advance on load).
  function bootstrap() {
    navigating = true;
    setTimeout(function() {
      var detected = detectCurrentSlide();
      if (detected !== null) currentIndex = detected;
      function finish() {
        navigating = false;
        postReady();
      }
      if (currentIndex !== initialTarget) {
        navigateTo(initialTarget, finish, true);
      } else {
        finish();
      }
    }, 200);
  }
  if (document.readyState === 'complete') setTimeout(bootstrap, 80);
  else window.addEventListener('load', function() { setTimeout(bootstrap, 80); });
})();
</script>`
  if (html.includes('</body>')) return html.replace('</body>', navScript + '\n</body>')
  return html + navScript
}
