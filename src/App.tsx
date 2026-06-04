import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'

// Each page is lazy-loaded — the browser only downloads a page's code when
// the user navigates to it. Landing + Join drop to ~150-250 KB on first load.
const Landing = lazy(() => import('@/pages/Landing'))
const Decks   = lazy(() => import('@/pages/Decks'))
const Create  = lazy(() => import('@/pages/Create'))
const Present = lazy(() => import('@/pages/Present'))
const Join    = lazy(() => import('@/pages/Join'))
const Vote    = lazy(() => import('@/pages/Vote'))
const Results = lazy(() => import('@/pages/Results'))
const Shared  = lazy(() => import('@/pages/Shared'))

// Minimal branded spinner shown while a page chunk downloads (<100ms on fast wifi)
function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-midnight-sky-900">
      <span className="text-sm font-bold tracking-tight text-white">
        alaya <span className="text-hot-pink">pulse</span>
      </span>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/"                    element={<Landing />} />
          <Route path="/decks"               element={<Decks />} />
          <Route path="/create"              element={<Create />} />
          <Route path="/present/:sessionId"  element={<Present />} />
          <Route path="/join"                element={<Join />} />
          <Route path="/vote/:sessionCode"   element={<Vote />} />
          <Route path="/results/:deckId"     element={<Results />} />
          <Route path="/shared/:shareId"    element={<Shared />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
