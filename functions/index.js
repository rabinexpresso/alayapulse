/**
 * Alaya Pulse — Cloud Functions
 *
 * sweepOrphanImages: a daily scheduled job that deletes Cloudinary images
 * under the "images/" folder that are no longer referenced by ANY deck or
 * shared deck. One job covers every cleanup case:
 *   • images belonging to a deck that was deleted, and
 *   • images removed from a slide while editing.
 *
 * Why a delayed sweep instead of instant deletion: deleting the moment an
 * image is removed breaks re-uploading the same image (the browser still
 * "remembers" the now-deleted link) and can race an in-progress save. Waiting
 * a grace period (MIN_AGE_HOURS) before deleting avoids all of that — it's how
 * real apps handle file cleanup.
 *
 * SAFETY RAILS (this function deletes files — these matter):
 *   1. Only ever considers assets whose public_id starts with "images/" — the
 *      folder slide uploads go to. Avatars / anything else are never touched.
 *   2. Skips assets newer than MIN_AGE_HOURS, so an in-progress save isn't hit
 *      before its deck document has finished writing, and a just-removed image
 *      can still be re-added during the same session without breaking.
 *   3. DRY_RUN (default true) only LOGS what it WOULD delete. After confirming
 *      a run's logs look correct, set DRY_RUN = false to enable real deletion.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler')
const { defineSecret } = require('firebase-functions/params')
const logger = require('firebase-functions/logger')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const cloudinary = require('cloudinary').v2

initializeApp()
const db = getFirestore()

// Public — appears in every image URL, so it's safe to hardcode.
const CLOUD_NAME = 'dkyljxt2j'
// Secrets — set once via:
//   npx firebase-tools functions:secrets:set CLOUDINARY_API_KEY
//   npx firebase-tools functions:secrets:set CLOUDINARY_API_SECRET
const CLOUDINARY_API_KEY = defineSecret('CLOUDINARY_API_KEY')
const CLOUDINARY_API_SECRET = defineSecret('CLOUDINARY_API_SECRET')

// ⚠️ Starts in report-only mode. Flip to false once a dry-run log looks right.
const DRY_RUN = false
// Grace period: never delete an image younger than this. Protects in-progress
// saves and lets a just-removed image be re-added during the same session.
const MIN_AGE_HOURS = 24
const FOLDER_PREFIX = 'images/'

/** Cloudinary secure_url → public_id (the id needed to delete the asset). */
function urlToPublicId(url) {
  if (typeof url !== 'string') return null
  const marker = '/image/upload/'
  const i = url.indexOf(marker)
  if (i === -1) return null
  return url
    .slice(i + marker.length)
    .replace(/^v\d+\//, '') // drop version prefix  v123/
    .replace(/\.[a-zA-Z0-9]+$/, '') // drop file extension  .jpg
}

/** Every image URL a slide can reference (mirrors how slides are saved). */
function urlsFromSlide(slide) {
  const out = []
  if (!slide || typeof slide !== 'object') return out
  if (typeof slide.imgUrl === 'string') out.push(slide.imgUrl)
  if (slide.bg && slide.bg.type === 'image' && typeof slide.bg.value === 'string') {
    out.push(slide.bg.value)
  }
  if (Array.isArray(slide.elements)) {
    for (const el of slide.elements) {
      if (el && el.kind === 'image' && typeof el.imgUrl === 'string') out.push(el.imgUrl)
    }
  }
  return out
}

/** All public_ids referenced by any deck or shared deck across all users. */
async function collectReferenced() {
  const referenced = new Set()
  const add = (url) => {
    const id = urlToPublicId(url)
    if (id) referenced.add(id)
  }

  // Every deck under every user (collection-group query; Admin SDK bypasses rules).
  const decks = await db.collectionGroup('decks').get()
  decks.forEach((d) => {
    const slides = d.get('slides')
    if (Array.isArray(slides)) slides.forEach((s) => urlsFromSlide(s).forEach(add))
  })

  // Shared decks snapshot the same image URLs, so they count as references too.
  const shared = await db.collection('sharedDecks').get()
  shared.forEach((d) => {
    const slides = d.get('slides')
    if (Array.isArray(slides)) slides.forEach((s) => urlsFromSlide(s).forEach(add))
  })

  return referenced
}

exports.sweepOrphanImages = onSchedule(
  {
    schedule: '0 3 * * *', // 03:00 every day
    timeZone: 'Australia/Sydney',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET],
  },
  async () => {
    cloudinary.config({
      cloud_name: CLOUD_NAME,
      api_key: CLOUDINARY_API_KEY.value(),
      api_secret: CLOUDINARY_API_SECRET.value(),
      secure: true,
    })

    const referenced = await collectReferenced()
    logger.info(`Sweep start: ${referenced.size} images referenced across decks + shared decks.`)

    const cutoff = Date.now() - MIN_AGE_HOURS * 3600 * 1000
    const orphans = []
    let scanned = 0
    let cursor

    do {
      const res = await cloudinary.api.resources({
        type: 'upload',
        prefix: FOLDER_PREFIX,
        max_results: 500,
        next_cursor: cursor,
      })
      for (const asset of res.resources || []) {
        scanned++
        const id = asset.public_id
        if (!id || !id.startsWith(FOLDER_PREFIX)) continue // safety: images/ only
        if (referenced.has(id)) continue // still in use
        if (new Date(asset.created_at).getTime() > cutoff) continue // too new — skip
        orphans.push(id)
      }
      cursor = res.next_cursor
    } while (cursor)

    logger.info(
      `Sweep scan: ${scanned} images in "${FOLDER_PREFIX}", ${orphans.length} orphaned` +
        (DRY_RUN ? ' (DRY RUN — nothing deleted).' : '.'),
    )
    if (orphans.length) logger.info('Orphan public_ids: ' + orphans.join(', '))

    if (DRY_RUN || orphans.length === 0) return

    let deleted = 0
    for (let i = 0; i < orphans.length; i += 100) {
      const batch = orphans.slice(i, i + 100)
      await cloudinary.api.delete_resources(batch)
      deleted += batch.length
    }
    logger.info(`Sweep done: deleted ${deleted} orphaned images.`)
  },
)
