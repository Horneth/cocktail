import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import './theme.css'
import { seedIfEmpty } from './db/seed'
import { ensureDefaultBar } from './domain/bars'
import { App } from './App'
import { HomeScreen } from './screens/HomeScreen'
import { RecipeDetailScreen } from './screens/RecipeDetailScreen'
import { EditRecipeScreen } from './screens/EditRecipeScreen'
import { ImportScreen } from './screens/ImportScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { BrowseScreen } from './screens/BrowseScreen'
import { BarScreen } from './screens/BarScreen'
import { SearchScreen } from './screens/SearchScreen'
import { stashSharedImport } from './import/shared'

// Hash routing keeps GitHub Pages happy: deep links and refreshes never 404,
// and offline navigation stays entirely client-side.
const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomeScreen /> },
      { path: 'search', element: <SearchScreen /> },
      { path: 'browse', element: <BrowseScreen /> },
      { path: 'recipe/:id', element: <RecipeDetailScreen /> },
      { path: 'recipe/:id/edit', element: <EditRecipeScreen /> },
      { path: 'new', element: <EditRecipeScreen /> },
      { path: 'import', element: <ImportScreen /> },
      { path: 'bar', element: <BarScreen /> },
      { path: 'settings', element: <SettingsScreen /> },
    ],
  },
])

// Android share target navigates to the start URL with ?title&text&url. Capture
// that before React mounts and stash it. We deliberately leave the router at the
// HOME route (just strip the query) — App then pushes /import via react-router so
// there's a real home entry behind it and Back works after a cold-start share.
function handleShareTarget() {
  if (!location.search) return
  stashSharedImport(location.search)
  history.replaceState(null, '', location.pathname + (location.hash || ''))
}

async function bootstrap() {
  handleShareTarget()
  try {
    await seedIfEmpty()
    await ensureDefaultBar()
  } catch (err) {
    console.error('Seeding failed', err)
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}

void bootstrap()
