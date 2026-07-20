import { useLayoutEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TabBar, type Tab } from './components/TabBar'
import { AddSheet } from './components/AddSheet'
import { hasSharedImport } from './import/shared'

// Which primary tab (if any) owns a given path. Pushed screens — recipe detail,
// import, build/edit, settings — return null and hide the tab bar; they carry
// their own back arrow and bottom CTA instead.
function tabForPath(pathname: string): Tab | null {
  if (pathname === '/') return 'home'
  if (pathname.startsWith('/search')) return 'search'
  if (pathname.startsWith('/browse')) return 'browse'
  if (pathname.startsWith('/bar')) return 'bar'
  return null
}

export function App() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const redirected = useRef(false)
  const [addOpen, setAddOpen] = useState(false)

  // A cold-start Android share boots the router at home (see main.tsx). If shared
  // text is waiting, push /import through react-router so home stays in history
  // and the Back button returns there. useLayoutEffect avoids a home flash.
  useLayoutEffect(() => {
    if (redirected.current) return
    if (hasSharedImport() && pathname === '/') {
      redirected.current = true
      navigate('/import')
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
      {tab && <TabBar active={tab} onAdd={() => setAddOpen(true)} />}
      <AddSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  )
}
