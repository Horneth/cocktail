import { Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'

export function App() {
  // Reset the boundary when the route changes, so navigating away from a screen
  // that threw clears the error instead of trapping the user on it.
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      <Outlet />
    </ErrorBoundary>
  )
}
