import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../store/auth'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const accessToken = useAuth((s) => s.accessToken)
  const location = useLocation()

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <>{children}</>
}
