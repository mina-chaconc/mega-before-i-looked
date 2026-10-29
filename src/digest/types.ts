export type DigestStatus = 'ok' | 'retry' | 'fail'

export type DigestRow = {
  job: string
  owner: string | null
  runs: number
  retries: number
  lastStatus: DigestStatus
  lastError: string | null
  firstAt: string
  lastAt: string
  hasFailure: boolean
}

export type NightDigest = {
  night: string
  rows: DigestRow[]
  badLines: number
  counts: Record<DigestStatus, number>
}

export type ReadNight = (runsDir: string, night: string) => NightDigest | null
