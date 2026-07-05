import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import './theme.css'
import { seedIfEmpty } from './db/seed'
import { App } from './App'
import { HomeScreen } from './screens/HomeScreen'
import { RecipeDetailScreen } from './screens/RecipeDetailScreen'
import { EditRecipeScreen } from './screens/EditRecipeScreen'
import { ImportScreen } from './screens/ImportScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { BrowseScreen } from './screens/BrowseScreen'
import { stashSharedImport } from './import/shared'

// Hash routing keeps GitHub Pages happy: deep links and refreshes never 404,
// and offline navigation stays entirely client-side.
const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomeScreen /> },
      { path: 'browse', element: <BrowseScreen /> },
      { path: 'recipe/:id', element: <RecipeDetailScreen /> },
      { path: 'recipe/:id/edit', element: <EditRecipeScreen /> },
      { path: 'new', element: <EditRecipeScreen /> },
      { path: 'import', element: <ImportScreen /> },
      { path: 'settings', element: <SettingsScreen /> },
    ],
  },
])

// Android share target navigates to the start URL with ?title&text&url. Capture
// that before React mounts, stash it, and drop into the Import screen. Also strip
// the query so a manual refresh doesn't re-trigger the import.
function handleShareTarget() {
  if (!location.search) return
  const stashed = stashSharedImport(location.search)
  const clean = location.pathname + (location.hash || '')
  history.replaceState(null, '', clean)
  if (stashed) location.hash = '#/import'
}

async function bootstrap() {
  handleShareTarget()
  try {
    await seedIfEmpty()
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
