import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './theme.css'
import { seedIfEmpty } from './db/seed'
import { App } from './App'
import { HomeScreen } from './screens/HomeScreen'
import { RecipeDetailScreen } from './screens/RecipeDetailScreen'
import { EditRecipeScreen } from './screens/EditRecipeScreen'

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomeScreen /> },
      { path: 'recipe/:id', element: <RecipeDetailScreen /> },
      { path: 'recipe/:id/edit', element: <EditRecipeScreen /> },
      { path: 'new', element: <EditRecipeScreen /> },
    ],
  },
])

async function bootstrap() {
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
