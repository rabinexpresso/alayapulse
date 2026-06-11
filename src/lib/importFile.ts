/* ─────────────────────────────────────────────────────────────────────────
   importFile — shared utility for converting a user-picked file into an
   array of Pulse slides.

   Used by:
     • Decks.tsx  → "Import deck" button on My Decks page (Option B: saves as
                    a new deck card, shows toast)
     • Create.tsx → "Import / Merge" button in the editor (adds slides to the
                    current deck in-place; HTML has extra auto-split logic
                    handled there directly)

   Supported formats:
     • .json / .apulse  — Alaya Pulse deck export
     • .pdf             — rasterised page-by-page (1 slide per page)
     • image/*          — single image slide
     • video/*          — single video slide (blob URL, browser-session only)
     • .html / .htm     — auto-split into N slides if internal slides detected,
                          otherwise single HTML slide
   ───────────────────────────────────────────────────────────────────────── */

/* PDF.js — lazy-loaded so the 1.2 MB worker only hits users who actually
   import a PDF. Module-level cache so subsequent imports are instant.    */
let _pdfjs: typeof import('pdfjs-dist') | null = null
async function getPdfjs() {
  if (_pdfjs) return _pdfjs
  _pdfjs = await import('pdfjs-dist')
  _pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href
  return _pdfjs
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

/* Detect how many internal slides a self-contained HTML presentation has.
   Checks the most common slideshow frameworks (reveal.js, impress.js, etc.).
   Returns null if the HTML doesn't look like a slideshow.               */
function detectHtmlSlideCount(html: string): number | null {
  if (!html || typeof DOMParser === 'undefined') return null
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const selectors = [
      '.reveal .slides > section',
      '.reveal > .slides > section',
      '.slides > section',
      '#impress .step',
      '.step',
      '[data-slide]',
      'section.slide',
      'div.slide',
      '.slide',
    ]
    for (const sel of selectors) {
      const count = doc.querySelectorAll(sel).length
      if (count > 1) return count
    }
    return null
  } catch {
    return null
  }
}

/* ── Return type ─────────────────────────────────────────────────────────── */

export interface ImportResult {
  /** The generated slides (with fresh IDs). */
  slides: unknown[]
  /**
   * Deck title extracted from the file, if available.
   * Only present for JSON/apulse imports that carry a title field.
   * Callers should fall back to the file name when this is undefined.
   */
  title?: string
}

/* ── Slide navigation injector ───────────────────────────────────────────── */

/**
 * Injects a post-load navigation script into an HTML slideshow so that when
 * it is split into individual Pulse slides, each iframe starts at the correct
 * internal slide rather than always defaulting to slide 1.
 *
 * Works with AI-generated HTML and common hand-coded slideshow patterns.
 * Tries the most common navigation function names in order.
 *
 * @param html       Full HTML source of the slideshow
 * @param slideIndex 0-based slide index (converted to 1-based inside the script)
 */
export function injectSlideNavigation(html: string, slideIndex: number): string {
  // Slide 0 is the default — no injection needed
  if (slideIndex === 0) return html

  const target = slideIndex + 1   // slideshow functions are typically 1-based
  const script = `
<script>
(function () {
  var _t = ${target};
  // Run AFTER the page's own window.onload has fired (which resets to slide 1).
  // setTimeout(0) is enough in most cases; 80ms gives slower pages room.
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (typeof gotoSlide   === 'function') { gotoSlide(_t);   return; }
      if (typeof showSlide   === 'function') { showSlide(_t);   return; }
      if (typeof goToSlide   === 'function') { goToSlide(_t);   return; }
      if (typeof changeSlide === 'function') { changeSlide(_t); return; }
      if (typeof navigateTo  === 'function') { navigateTo(_t);  return; }
    }, 80);
  });
})();
</script>`

  // Prefer injecting before </body> (case-insensitive); fall back to appending
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, script + '\n</body>')
  }
  return html + script
}

/* ── Main export ─────────────────────────────────────────────────────────── */

export async function importFileToSlides(file: File): Promise<ImportResult> {

  /* ── Alaya Pulse deck JSON (.apulse.json) ────────────────────────────── */
  if (file.name.endsWith('.json') || file.name.endsWith('.apulse')) {
    const text = await file.text()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error('Could not import — the file may be invalid or corrupted.')
    }
    if (!Array.isArray(data?.slides)) {
      throw new Error('Could not import — the file may be invalid or corrupted.')
    }
    // Regenerate IDs so imported slides never clash with existing ones
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const slides = (data.slides as any[]).map((s: any) => ({ ...s, id: uid() }))
    const title  = typeof data.title === 'string' ? data.title : undefined
    return { slides, title }
  }

  /* ── PDF: rasterise each page to JPEG ───────────────────────────────── */
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const buf      = await file.arrayBuffer()
    const pdfjsLib = await getPdfjs()
    const pdf      = await pdfjsLib.getDocument({ data: buf }).promise
    const slides: unknown[] = []
    for (let p = 1; p <= pdf.numPages; p++) {
      const page     = await pdf.getPage(p)
      const viewport = page.getViewport({ scale: 2.0 })  // ~1920×1080 for 16∶9
      const canvas   = document.createElement('canvas')
      canvas.width   = viewport.width
      canvas.height  = viewport.height
      const ctx      = canvas.getContext('2d')!
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      slides.push({ id: uid(), type: 'pdf', pageNum: p, imgUrl: canvas.toDataURL('image/jpeg', 0.92) })
    }
    return { slides }
  }

  /* ── Image: inline as data URL ──────────────────────────────────────── */
  if (file.type.startsWith('image/')) {
    const imgUrl = await new Promise<string>((resolve, reject) => {
      const reader   = new FileReader()
      reader.onload  = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    return { slides: [{ id: uid(), type: 'image', imgUrl, fileName: file.name }] }
  }

  /* ── Video: object URL (browser-session only, not cloud-saveable) ───── */
  if (file.type.startsWith('video/')) {
    const videoUrl = URL.createObjectURL(file)
    return { slides: [{ id: uid(), type: 'video', videoUrl, videoType: file.type, fileName: file.name }] }
  }

  /* ── HTML: auto-split if multiple slides detected, else single slide ─── */
  if (
    file.type === 'text/html' ||
    file.name.toLowerCase().endsWith('.html') ||
    file.name.toLowerCase().endsWith('.htm')
  ) {
    const html     = await file.text()
    const detected = detectHtmlSlideCount(html)
    if (detected !== null && detected >= 2) {
      const slides = Array.from({ length: detected }, (_, i) => ({
        id:         uid(),
        type:       'html',
        html:       injectSlideNavigation(html, i),
        fileName:   file.name,
        slideIndex: i,
        slideTotal: detected,
      }))
      return { slides }
    }
    return { slides: [{ id: uid(), type: 'html', html, fileName: file.name }] }
  }

  /* ── Unsupported ─────────────────────────────────────────────────────── */
  throw new Error(
    `Unsupported file type: ${file.type || file.name}.\n` +
    'Supported formats: .json, .apulse, .pdf, .html, image (JPEG/PNG/GIF/WebP), video (MP4/WebM).',
  )
}
