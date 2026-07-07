import { useLayoutEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { hasSharedImport } from './import/shared'

export function App() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const redirected = useRef(false)

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

  // Reset the boundary when the route changes, so navigating away from a screen
  // that threw clears the error instead of trapping the user on it.
  return (
    <ErrorBoundary resetKey={pathname}>
      <Outlet />
    </ErrorBoundary>
  )
}
