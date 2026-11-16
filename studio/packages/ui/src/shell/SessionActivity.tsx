import type { Plan, SessionConfigOption } from '@openclaude-studio/acp'
import { Badge } from '../shadcn/badge.js'
import { Button } from '../shadcn/button.js'
import { Card, CardContent, CardHeader, CardTitle } from '../shadcn/card.js'

export type SessionNotice = {
  severity: string
  title: string
  description?: string | null
}

export type SessionCompactionSummary = {
  compactionId: string
  status: string
  error: string | null
}

export type SessionActivityProps = {
  notice?: SessionNotice | null | undefined
  onDismissNotice?: (() => void) | undefined
  plan?: Plan | null | undefined
  compactions?: SessionCompactionSummary[] | undefined
  configOptions?: SessionConfigOption[] | undefined
  onConfigOptionChange?: ((optionId: string, value: string | boolean) => void) | undefined
}

const PLAN_STATUS_VARIANT: Record<string, 'default' | 'accent' | 'success'> = {
  pending: 'default',
  in_progress: 'accent',
  completed: 'success',
}

type SelectValue = { value: string; name: string }

/** Flatten a select option's payload, tolerating both flat and grouped forms. */
function selectValues(option: SessionConfigOption): SelectValue[] {
  if (option.type !== 'select') return []
  const raw = option.options as Array<{
    value?: string
    name?: string
    options?: Array<{ value: string; name: string }>
  }>
  if (raw.length === 0) return []
  if ('options' in raw[0]!) {
    return raw.flatMap(group => group.options ?? [])
  }
  return raw.map(entry => ({ value: entry.value ?? '', name: entry.name ?? entry.value ?? '' }))
}

export function SessionActivity({
  notice,
  onDismissNotice,
  plan,
  compactions,
  configOptions,
  onConfigOptionChange,
}: SessionActivityProps) {
  const entries = plan?.entries ?? []
  const compactionRows = compactions ?? []
  const options = configOptions ?? []
  const noticeRole = notice && /error|warning/i.test(notice.severity) ? 'alert' : 'status'

  if (!notice && entries.length === 0 && compactionRows.length === 0 && options.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-2 border-b border-line px-4 py-2">
      {notice ? (
        <Card role={noticeRole} aria-live={noticeRole === 'alert' ? 'assertive' : 'polite'}>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{notice.severity}</Badge>
                <CardTitle className="truncate text-[13px]">{notice.title}</CardTitle>
              </div>
              {notice.description ? (
                <p className="text-[12px] text-ink-3">{notice.description}</p>
              ) : null}
            </div>
            {onDismissNotice ? (
              <Button variant="quiet" size="xs" onClick={onDismissNotice} aria-label="Dismiss notice">
                Dismiss
              </Button>
            ) : null}
          </CardHeader>
        </Card>
      ) : null}

      {entries.length > 0 ? (
        <Card>
          <CardHeader className="py-2">
            <CardTitle className="text-[13px]">Plan</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <ol className="flex flex-col gap-1.5">
              {entries.map((entry, index) => (
                <li key={`${entry.content}-${index}`} className="flex items-start gap-2">
                  <Badge variant={PLAN_STATUS_VARIANT[entry.status] ?? 'default'}>
                    {entry.status}
                  </Badge>
                  <span className="text-[13px] text-ink">{entry.content}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      {compactionRows.length > 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-1 py-2">
            {compactionRows.map(compaction => (
              <div key={compaction.compactionId} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-ink-3">Context compaction:</span>
                  <Badge variant={compaction.status === 'completed' ? 'success' : 'outline'}>
                    {compaction.status}
                  </Badge>
                </div>
                {compaction.error ? (
                  <p role="alert" className="text-[12px] text-red">
                    {compaction.error}
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {options.length > 0 ? (
        <Card>
          <CardHeader className="py-2">
            <CardTitle className="text-[13px]">Session options</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 py-2">
            {options.map(option => {
              if (option.type === 'boolean') {
                return (
                  <div key={option.id} className="flex items-center justify-between gap-3">
                    <span className="text-[12px] text-ink-3">{option.name}</span>
                    <Button
                      variant={option.currentValue ? 'accent' : 'outline'}
                      size="xs"
                      aria-pressed={option.currentValue}
                      onClick={() => onConfigOptionChange?.(option.id, !option.currentValue)}
                    >
                      {option.currentValue ? 'On' : 'Off'}
                    </Button>
                  </div>
                )
              }

              const values = selectValues(option)
              if (values.length === 0) return null
              return (
                <div key={option.id} className="flex flex-col gap-1">
                  <span className="text-[12px] text-ink-3">{option.name}</span>
                  <div className="flex flex-wrap gap-1">
                    {values.map(value => (
                      <Button
                        key={value.value}
                        variant={value.value === option.currentValue ? 'accent' : 'quiet'}
                        size="xs"
                        aria-pressed={value.value === option.currentValue}
                        onClick={() => onConfigOptionChange?.(option.id, value.value)}
                      >
                        {value.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
