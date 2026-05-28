import { AnimatePresence } from 'framer-motion'
import { Route, Routes, useLocation } from 'react-router-dom'
import Landing from './pages/Landing'
import Login from './pages/Login'
import PickUsername from './pages/PickUsername'
import Profile from './pages/Profile'
import Home from './pages/Home'
import { ProtectedRoute } from './components/ProtectedRoute'

export function AppRoutes() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/pick-username"
          element={
            <ProtectedRoute allowMissingUsername>
              <PickUsername />
            </ProtectedRoute>
          }
        />
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          }
        />
        {/* Channels and groups share the same shell as DMs — Home reads the
            uname param and renders ChannelView in the chat column. */}
        <Route
          path="/c/:uname"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AnimatePresence>
  )
}
