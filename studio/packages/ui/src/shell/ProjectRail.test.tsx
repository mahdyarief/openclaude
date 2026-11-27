import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProjectRail } from './ProjectRail.js'

const noop = () => {}

describe('ProjectRail', () => {
  test('renders each workspace with its sessions nested underneath', () => {
    const html = renderToStaticMarkup(
      <ProjectRail
        workspaces={[
          {
            path: '/home/dy/code/app',
            name: 'app',
            sessions: [{ id: 's1', title: 'First task', active: true }],
            openIds: ['s1'],
          },
        ]}
        onSelectWorkspace={noop}
        onSelectSession={noop}
        onNewSession={noop}
      />,
    )
    expect(html).toContain('Workspaces')
    expect(html).toContain('app')
    expect(html).toContain('First task')
    expect(html).toContain('aria-current')
  })

  test('keeps only sessions open in tabs visible in the rail', () => {
    const html = renderToStaticMarkup(
      <ProjectRail
        workspaces={[
          {
            path: '/a',
            name: 'alpha-project',
            sessions: [
              { id: 'a1', title: 'open-session', active: true },
              { id: 'a2', title: 'closed-history-session', active: false },
            ],
            openIds: ['a1'],
          },
          {
            path: '/b',
            name: 'beta-project',
            sessions: [{ id: 'b1', title: 'other-history-session', active: false }],
          },
        ]}
        activePath="/a"
        onSelectWorkspace={noop}
        onSelectSession={noop}
        onNewSession={noop}
      />,
    )
    expect(html).toContain('open-session')
    expect(html).not.toContain('closed-history-session')
    expect(html).not.toContain('other-history-session')
    expect(html).toContain('History')
  })

  test('does not mount closed history dialogs', () => {
    const html = renderToStaticMarkup(
      <ProjectRail
        workspaces={[
          {
            path: '/a',
            name: 'alpha-project',
            sessions: [{ id: 'a1', title: 'history-only-session', active: false }],
          },
        ]}
        onSelectWorkspace={noop}
        onSelectSession={noop}
        onNewSession={noop}
      />,
    )
    expect(html).not.toContain('history-only-session')
    expect(html).not.toContain('dialog-content')
  })

  test('shows a loading skeleton while a workspace loads', () => {
    const html = renderToStaticMarkup(
      <ProjectRail
        workspaces={[{ path: '/p', name: 'ws', sessions: [], loading: true }]}
        onSelectWorkspace={noop}
        onSelectSession={noop}
        onNewSession={noop}
      />,
    )
    expect(html).not.toContain('No sessions')
  })

  test('shows an empty state when there are no workspaces', () => {
    const html = renderToStaticMarkup(
      <ProjectRail
        workspaces={[]}
        onSelectWorkspace={noop}
        onSelectSession={noop}
        onNewSession={noop}
      />,
    )
    expect(html).toContain('No workspaces yet')
  })
})
