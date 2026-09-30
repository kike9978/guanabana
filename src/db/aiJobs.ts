import { newRecord, settle, openDb, writeAcross } from './db'
import type { AiJob, AiTask } from './types'

export async function createAiJob(task: AiTask, promptHash: string): Promise<AiJob> {
  const job = newRecord<AiJob>({ task, status: 'prompt_copied', prompt_hash: promptHash, response_hash: null })
  await writeAcross([{ store: 'ai_jobs', put: [job] }])
  return job
}

export async function updateAiJob(job: AiJob, fields: Pick<AiJob, 'status' | 'prompt_hash' | 'response_hash'>): Promise<AiJob> {
  const next: AiJob = { ...job, ...fields, updated_at: new Date().toISOString() }
  await writeAcross([{ store: 'ai_jobs', put: [next] }])
  return next
}

export async function hasCommittedResponse(responseHash: string): Promise<boolean> {
  const db = await openDb()
  const jobs = (await settle(db.transaction('ai_jobs').objectStore('ai_jobs').getAll())) as AiJob[]
  return jobs.some((job) => job.status === 'committed' && job.response_hash === responseHash)
}
