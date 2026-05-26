import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Landing from '@/pages/Landing'
import Decks from '@/pages/Decks'
import Create from '@/pages/Create'
import Present from '@/pages/Present'
import Join from '@/pages/Join'
import Vote from '@/pages/Vote'
import Results from '@/pages/Results'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/decks" element={<Decks />} />
        <Route path="/create" element={<Create />} />
        <Route path="/present/:sessionId" element={<Present />} />
        <Route path="/join" element={<Join />} />
        <Route path="/vote/:sessionCode" element={<Vote />} />
        <Route path="/results/:deckId" element={<Results />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
