import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import './theme.css'
import { seedIfEmpty } from './db/seed'
import { ensureDefaultBar } from './domain/bars'
import { App } from './App'
import { RecipesScreen } from './screens/RecipesScreen'
import { RecipeDetailScreen } from './screens/RecipeDetailScreen'
import { EditRecipeScreen } from './screens/EditRecipeScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { BarScreen } from './screens/bar/BarScreen'
import { stashSharedImport } from './import/shared'

// Hash routing: deep links and refreshes never 404 without a server-side SPA
// rewrite, and offline navigation stays entirely client-side. Originally chosen
// for GitHub Pages; kept after the move to Firebase Hosting so already-installed
// PWAs and shared links keep resolving.
const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <RecipesScreen /> },
      { path: 'recipe/:id', element: <RecipeDetailScreen /> },
      { path: 'recipe/:id/edit', element: <EditRecipeScreen /> },
      { path: 'new', element: <EditRecipeScreen /> },
      { path: 'bar', element: <BarScreen /> },
      { path: 'settings', element: <SettingsScreen /> },
    ],
  },
])

// Android share target navigates to the start URL with ?title&text&url. Capture
// that before React mounts and stash it. We deliberately leave the router at the
// RECIPES route (just strip the query) — App then pushes /new via react-router so
// there's a real recipes entry behind it and Back works after a cold-start share.
function handleShareTarget() {
  if (!location.search) return
  stashSharedImport(location.search)
  history.replaceState(null, '', location.pathname + (location.hash || ''))
}

// Cloud AI used to be bring-your-own-key: the user's own Gemini credential sat
// in localStorage. Firebase AI Logic retired that, but simply deleting the code
// would leave the key sitting in every existing install's storage forever. It is
// a live credential we no longer have any use for, so scrub it on boot. Safe to
// delete this once the app has been out long enough for installs to have run it.
function forgetRetiredApiKey() {
  localStorage.removeItem('cocktail.geminiKey')
  localStorage.removeItem('cocktail.geminiModel')
}

async function bootstrap() {
  handleShareTarget()
  forgetRetiredApiKey()
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
