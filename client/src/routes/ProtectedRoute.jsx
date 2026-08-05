export default function ProtectedRoute({ user, role, children }) { if (!user) return null; return !role || user.role === role ? children : null; }
