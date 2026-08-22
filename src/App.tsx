import { useLayoutEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TabBar, type Tab } from './components/TabBar'
import { hasSharedImport } from './import/shared'

// Which primary tab owns a given path. The cocktail/bar tabs are the whole
// app; a pushed screen (recipe detail, build/edit, settings) returns null and
// hides the tab bar, carrying its own back arrow and bottom CTA instead.
function tabForPath(pathname: string): Tab | null {
  if (pathname === '/' || pathname === '') return 'recipes'
  if (pathname.startsWith('/bar')) return 'bar'
  if (pathname.startsWith('/settings')) return 'settings'
  return null
}

export function App() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const redirected = useRef(false)

  // A cold-start Android share boots the router at home (see main.tsx). If
  // shared text is waiting, push the recipe editor through react-router so home
  // stays in history and the Back button returns there, and the editor offers to
  // fill itself from the pasted text. useLayoutEffect avoids a home flash.
  useLayoutEffect(() => {
    if (redirected.current) return
    if (hasSharedImport() && pathname === '/') {
      redirected.current = true
      navigate('/new')
    }
  }, [pathname, navigate])

  const tab = tabForPath(pathname)

  // Reset the boundary when the route changes, so navigating away from a screen
  // that threw clears the error instead of trapping the user on it.
  return (
    <>
      <ErrorBoundary resetKey={pathname}>
        <Outlet />
      </ErrorBoundary>
      {tab && <TabBar active={tab} />}
    </>
  )
}
