import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../store/auth'

type Props = {
  children: ReactNode
  /** When true, allow access even if the user hasn't picked a username yet. */
  allowMissingUsername?: boolean
}

export function ProtectedRoute({ children, allowMissingUsername = false }: Props) {
  const accessToken = useAuth((s) => s.accessToken)
  const user = useAuth((s) => s.user)
  const location = useLocation()

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  // After Google sign-in, a brand-new account has user.username === null and
  // is parked at /pick-username until they choose one.
  if (!allowMissingUsername && user && user.username == null) {
    return <Navigate to="/pick-username" replace />
  }

  return <>{children}</>
}
