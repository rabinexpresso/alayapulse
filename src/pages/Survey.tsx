import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { SurveyRunner } from '@/components/SurveyRunner'
import { subscribeToSession, type Session } from '@/lib/session'
import { isSurvey, type StoredTestBlockSlide } from '@/lib/selfPacedTest'

/* ─────────────────────────────────────────────────────────────────────────
   Survey link — /s/<session code>[/<block id>]
   People answer here before, during or after the show, on a phone or a
   computer, for as long as the host keeps the survey open. No name or code
   to type: the link carries everything.
   ───────────────────────────────────────────────────────────────────────── */

export default function Survey() {
  const { code = '', blockId } = useParams<{ code: string; blockId?: string }>()
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => subscribeToSession(code, setSession), [code])

  const surveys = (session?.slides ?? []).filter(s => s.type === 'testblock' && isSurvey(s as StoredTestBlockSlide)) as StoredTestBlockSlide[]
  const block = blockId ? surveys.find(s => s.id === blockId) : surveys[0]

  return (
    <main className="flex min-h-screen flex-col bg-midnight-sky-50/60">
      <header className="flex shrink-0 items-center justify-between px-5 py-4">
        <span className="text-sm font-bold tracking-tight text-midnight-sky-900">
          alaya <span className="text-hot-pink">pulse</span>
        </span>
      </header>
      <div className="flex flex-1 flex-col px-4 pb-10 pt-1">
        {session === undefined ? (
          <p className="m-auto text-sm text-midnight-sky-400">Loading the survey…</p>
        ) : !session || !block ? (
          <div className="m-auto max-w-sm text-center">
            <h1 className="text-xl font-bold text-midnight-sky-900">Survey not found</h1>
            <p className="mt-2 text-sm text-midnight-sky-500">Check the link — or ask whoever sent it for a new one.</p>
          </div>
        ) : (
          <SurveyRunner code={code} block={block} state={session.surveys?.[block.id]} standalone />
        )}
      </div>
    </main>
  )
}
