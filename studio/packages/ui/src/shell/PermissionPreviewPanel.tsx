import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { PermissionPreview } from '@openclaude-studio/acp'
import { Badge } from '../shadcn/badge.js'
import { Button } from '../shadcn/button.js'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../shadcn/card.js'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../shadcn/collapsible.js'
import { cn } from '../lib/cn.js'
import { DiffLines } from './MessageBubble.js'

export function PermissionPreviewPanel({
  preview,
}: {
  preview: PermissionPreview
}) {
  const [open, setOpen] = useState(true)
  const hasDetail = preview.diff !== null || preview.plan !== null
  return (
    <Card className="mb-3">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">{preview.title}</CardTitle>
            {hasDetail ? (
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="Toggle details">
                  <ChevronDown
                    className={cn('size-4 transition-transform', !open && '-rotate-90')}
                  />
                </Button>
              </CollapsibleTrigger>
            ) : null}
          </div>
          {preview.summary ? (
            <CardDescription className="font-mono text-[11.5px]">
              {preview.summary}
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {preview.fields.length > 0 ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">
              {preview.fields.map(field => (
                <div key={field.label} className="col-span-2 grid grid-cols-subgrid">
                  <dt className="text-ink-3">{field.label}</dt>
                  <dd className="break-words font-mono text-ink-2">{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <CollapsibleContent className="flex flex-col gap-2">
            {preview.plan ? (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-control)] border border-line bg-inset p-2 text-[11.5px] text-ink-2">
                {preview.plan}
              </pre>
            ) : null}
            {preview.diff ? (
              <div className="flex flex-col gap-1">
                <Badge variant="outline" className="w-fit font-mono text-[10.5px]">
                  {preview.diff.path}
                </Badge>
                <DiffLines diff={preview.diff} />
              </div>
            ) : null}
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  )
}
